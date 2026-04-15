import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { getPresignedUrl } from '../utils/s3.js';
import { validatePassword } from '../utils/passwordValidator.js';

const router = Router();

async function resolveLogoUrl(companyLogo) {
  if (!companyLogo || companyLogo.startsWith('http') || companyLogo.startsWith('data:')) return companyLogo;
  try { return await getPresignedUrl(companyLogo, 3600 * 12); } catch { return null; }
}

const sanitize = async (u) => ({
  id: u.id, email: u.email, name: u.name,
  firstName: u.firstName, lastName: u.lastName,
  companyName: u.companyName, companyLogo: await resolveLogoUrl(u.companyLogo), brandColor: u.brandColor,
  plan: u.plan, subscriptionStatus: u.subscriptionStatus,
  trialEndsAt: u.trialEndsAt, currentPeriodEnd: u.currentPeriodEnd, billingCycle: u.billingCycle,
  onboardingStep: u.onboardingStep,
  role: u.role, inviterUserId: u.inviterUserId,
});

// PUT /api/profile/personal — update name/email
router.put('/personal', authenticate, async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const data = {};
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;
    if (firstName || lastName) data.name = `${firstName || ''} ${lastName || ''}`.trim();
    if (email && email !== req.user.email) {
      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) return res.status(409).json({ error: 'Email already in use' });
      data.email = email;
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ user: await sanitize(user) });
  } catch (err) {
    console.error('profile/personal:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/profile/password
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = await bcrypt.compare(currentPassword, u.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash } });
    res.json({ ok: true });
  } catch (err) {
    console.error('profile/password:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// PUT /api/profile/company — owner/admin only
router.put('/company', authenticate, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (me.role === 'member') return res.status(403).json({ error: 'Forbidden' });
    const { companyName, companyLogo, brandColor } = req.body;
    const data = {};
    if (companyName !== undefined) data.companyName = companyName;
    if (companyLogo !== undefined) data.companyLogo = companyLogo;
    if (brandColor !== undefined) data.brandColor = brandColor;
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ user: await sanitize(user) });
  } catch (err) {
    console.error('profile/company:', err);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

export default router;
