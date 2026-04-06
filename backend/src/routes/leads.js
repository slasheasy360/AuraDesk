import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import { emitToUser } from '../utils/socket.js';

const router = Router();

const VALID_STATUSES = ['New', 'Warm', 'Won', 'Lost'];

// ─── GET /api/leads — list with multi-filter ───
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, platform, status, lastAction, dateFrom, dateTo } = req.query;
    const where = { userId: req.user.id };

    if (platform) where.platform = platform;
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (lastAction) where.lastAction = lastAction;
    if (dateFrom || dateTo) {
      where.lastContactedAt = {};
      if (dateFrom) where.lastContactedAt.gte = new Date(dateFrom);
      if (dateTo) where.lastContactedAt.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        invoices: {
          select: { id: true, status: true, total: true, invoiceNumber: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    res.json({ leads });
  } catch (err) {
    console.error('List leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// ─── POST /api/leads — create ───
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, platform, lastContactedAt, lastAction, status, conversationId, email, phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const lead = await prisma.lead.create({
      data: {
        userId: req.user.id,
        name: name.trim(),
        platform: platform || null,
        lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : null,
        lastAction: lastAction || null,
        status: VALID_STATUSES.includes(status) ? status : 'New',
        conversationId: conversationId || null,
        email: email || null,
        phone: phone || null,
      },
    });
    emitToUser(req.user.id, 'lead_created', { lead });
    res.status(201).json({ lead });
  } catch (err) {
    console.error('Create lead error:', err);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// ─── PATCH /api/leads/:id — update (status, fields) ───
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.lead.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    const data = {};
    const { name, platform, lastContactedAt, lastAction, status, conversationId, email, phone } = req.body;
    if (name !== undefined) data.name = name;
    if (platform !== undefined) data.platform = platform;
    if (lastContactedAt !== undefined) data.lastContactedAt = lastContactedAt ? new Date(lastContactedAt) : null;
    if (lastAction !== undefined) data.lastAction = lastAction;
    if (status !== undefined && VALID_STATUSES.includes(status)) data.status = status;
    if (conversationId !== undefined) data.conversationId = conversationId;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;

    const lead = await prisma.lead.update({ where: { id: existing.id }, data });
    emitToUser(req.user.id, 'lead_updated', { lead });
    res.json({ lead });
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// ─── DELETE /api/leads/:id ───
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.lead.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });
    await prisma.lead.delete({ where: { id: existing.id } });
    emitToUser(req.user.id, 'lead_deleted', { id: existing.id });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

export default router;
