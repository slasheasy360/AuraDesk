import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Determine the workspace owner id for any user (themselves if owner, otherwise their inviter)
async function workspaceOwnerId(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  return u.inviterUserId || u.id;
}

// GET /api/team/members — list all members in this workspace
router.get('/members', authenticate, async (req, res) => {
  try {
    const ownerId = await workspaceOwnerId(req.user.id);
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    const members = await prisma.user.findMany({
      where: { inviterUserId: ownerId },
      orderBy: { createdAt: 'asc' },
    });
    const all = [owner, ...members].filter(Boolean).map((u) => ({
      id: u.id,
      name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
      email: u.email,
      role: u.role,
      avatarUrl: u.companyLogo || null,
      isOwner: u.id === ownerId,
    }));
    const pending = await prisma.teamInvite.findMany({
      where: { inviterId: ownerId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ members: all, pending });
  } catch (err) {
    console.error('team/members:', err);
    res.status(500).json({ error: 'Failed to list team' });
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/team/invite — owner/admin only
router.post('/invite', authenticate, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (me.role !== 'owner' && me.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can invite members' });
    }
    const ownerId = me.inviterUserId || me.id;
    const { email } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    // Check duplicates
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    const existingInvite = await prisma.teamInvite.findUnique({
      where: { inviterId_email: { inviterId: ownerId, email } },
    });
    if (existingInvite && existingInvite.status === 'pending' && existingInvite.expiresAt > new Date()) {
      return res.status(409).json({ error: 'Invite already pending for this email', invite: existingInvite });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = existingInvite
      ? await prisma.teamInvite.update({
          where: { id: existingInvite.id },
          data: { token, expiresAt, status: 'pending', acceptedAt: null },
        })
      : await prisma.teamInvite.create({
          data: { inviterId: ownerId, email, token, expiresAt, role: 'member' },
        });

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
    const inviteLink = `${frontendUrl}/invite/${token}`;

    // TODO: Send email via SES/SendGrid. For now we return the link so the UI can copy it.
    res.json({ invite, inviteLink });
  } catch (err) {
    console.error('team/invite:', err);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// DELETE /api/team/invite/:id — revoke pending invite
router.delete('/invite/:id', authenticate, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (me.role === 'member') return res.status(403).json({ error: 'Forbidden' });
    const ownerId = me.inviterUserId || me.id;
    await prisma.teamInvite.updateMany({
      where: { id: req.params.id, inviterId: ownerId },
      data: { status: 'revoked' },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

// DELETE /api/team/members/:id — remove a team member
router.delete('/members/:id', authenticate, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (me.role !== 'owner' && me.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const ownerId = me.inviterUserId || me.id;
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.inviterUserId !== ownerId) {
      return res.status(404).json({ error: 'Member not found' });
    }
    await prisma.user.delete({ where: { id: target.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('team/remove:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// PUBLIC: GET /api/team/invite/:token — verify invite token
router.get('/invite/:token', async (req, res) => {
  try {
    const invite = await prisma.teamInvite.findUnique({
      where: { token: req.params.token },
      include: { inviter: { select: { companyName: true, name: true, email: true } } },
    });
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.status !== 'pending') return res.status(410).json({ error: 'Invite is no longer valid' });
    if (invite.expiresAt < new Date()) {
      await prisma.teamInvite.update({ where: { id: invite.id }, data: { status: 'expired' } });
      return res.status(410).json({ error: 'Invite expired' });
    }
    res.json({
      email: invite.email,
      role: invite.role,
      companyName: invite.inviter.companyName || invite.inviter.name,
      inviterEmail: invite.inviter.email,
    });
  } catch (err) {
    console.error('team/verify:', err);
    res.status(500).json({ error: 'Failed to verify invite' });
  }
});

// PUBLIC: POST /api/team/accept — accept invite, create user, return JWT
router.post('/accept', async (req, res) => {
  try {
    const { token, password, firstName, lastName } = req.body;
    if (!token || !password || password.length < 6) {
      return res.status(400).json({ error: 'Token and password (min 6 chars) required' });
    }
    const invite = await prisma.teamInvite.findUnique({ where: { token } });
    if (!invite || invite.status !== 'pending') {
      return res.status(410).json({ error: 'Invite is no longer valid' });
    }
    if (invite.expiresAt < new Date()) {
      await prisma.teamInvite.update({ where: { id: invite.id }, data: { status: 'expired' } });
      return res.status(410).json({ error: 'Invite expired' });
    }
    const exists = await prisma.user.findUnique({ where: { email: invite.email } });
    if (exists) return res.status(409).json({ error: 'Account already exists' });

    const owner = await prisma.user.findUnique({ where: { id: invite.inviterId } });

    const passwordHash = await bcrypt.hash(password, 12);
    const fullName = `${firstName || ''} ${lastName || ''}`.trim() || invite.email.split('@')[0];

    const user = await prisma.user.create({
      data: {
        email: invite.email,
        name: fullName,
        firstName: firstName || null,
        lastName: lastName || null,
        passwordHash,
        role: invite.role,
        inviterUserId: invite.inviterId,
        // Inherit workspace plan & onboarding so member can use the app immediately
        plan: owner?.plan || 'pro',
        subscriptionStatus: owner?.subscriptionStatus || 'active',
        companyName: owner?.companyName,
        companyLogo: owner?.companyLogo,
        brandColor: owner?.brandColor,
        onboardingStep: 4,
      },
    });

    await prisma.teamInvite.update({
      where: { id: invite.id },
      data: { status: 'accepted', acceptedAt: new Date() },
    });

    const jwtToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token: jwtToken,
    });
  } catch (err) {
    console.error('team/accept:', err);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

export default router;
