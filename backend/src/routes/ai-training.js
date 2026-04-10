import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';

const router = Router();

// ── GET /api/ai-training/faqs ─────────────────────────────────────────
router.get('/faqs', authenticate, async (req, res) => {
  const { category } = req.query;
  const where = { userId: req.user.id };
  if (category && category !== 'all') where.category = category;

  const faqs = await prisma.faq.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });
  res.json({ faqs });
});

// ── POST /api/ai-training/faqs ────────────────────────────────────────
router.post('/faqs', authenticate, async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const created = await Promise.all(
    items.map(({ question, answer, category = 'general' }) =>
      prisma.faq.create({
        data: { userId: req.user.id, question, answer, category },
      })
    )
  );
  res.status(201).json({ faqs: created });
});

// ── PUT /api/ai-training/faqs/:id ────────────────────────────────────
router.put('/faqs/:id', authenticate, async (req, res) => {
  const { question, answer, category } = req.body;
  const faq = await prisma.faq.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!faq) return res.status(404).json({ error: 'FAQ not found' });

  const updated = await prisma.faq.update({
    where: { id: req.params.id },
    data: { question, answer, category },
  });
  res.json({ faq: updated });
});

// ── DELETE /api/ai-training/faqs/:id ─────────────────────────────────
router.delete('/faqs/:id', authenticate, async (req, res) => {
  const faq = await prisma.faq.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!faq) return res.status(404).json({ error: 'FAQ not found' });
  await prisma.faq.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── GET /api/ai-training/settings ────────────────────────────────────
router.get('/settings', authenticate, async (req, res) => {
  let settings = await prisma.aiSettings.findUnique({
    where: { userId: req.user.id },
  });
  if (!settings) {
    settings = await prisma.aiSettings.create({
      data: { userId: req.user.id, tones: ['friendly'], automations: [] },
    });
  }
  res.json({ settings });
});

// ── PUT /api/ai-training/settings ────────────────────────────────────
router.put('/settings', authenticate, async (req, res) => {
  const { tones, automations } = req.body;
  const settings = await prisma.aiSettings.upsert({
    where: { userId: req.user.id },
    update: {
      ...(tones !== undefined && { tones }),
      ...(automations !== undefined && { automations }),
    },
    create: {
      userId: req.user.id,
      tones: tones || ['friendly'],
      automations: automations || [],
    },
  });
  res.json({ settings });
});

export default router;
