import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import { storeFaqEmbedding } from '../services/embeddings.js';

const router = Router();

// Resolve the workspace owner's ID — team members share the owner's knowledge base.
function resolveOwnerId(user) {
  return user.inviterUserId || user.id;
}

// ── GET /api/ai-training/faqs ─────────────────────────────────────────
router.get('/faqs', authenticate, async (req, res) => {
  const { category } = req.query;
  const ownerId = resolveOwnerId(req.user);
  const where = { userId: ownerId };
  if (category && category !== 'all') where.category = category;

  const faqs = await prisma.faq.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });
  res.json({ faqs });
});

// ── POST /api/ai-training/faqs ────────────────────────────────────────
router.post('/faqs', authenticate, async (req, res) => {
  const ownerId = resolveOwnerId(req.user);
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const created = await Promise.all(
    items.map(({ question, answer, category = 'general' }) =>
      prisma.faq.create({
        data: { userId: ownerId, question, answer, category },
      })
    )
  );

  // Generate embeddings asynchronously — don't block the response
  created.forEach(faq => {
    storeFaqEmbedding(faq.id, faq.question, faq.answer);
  });

  res.status(201).json({ faqs: created });
});

// ── PUT /api/ai-training/faqs/:id ────────────────────────────────────
router.put('/faqs/:id', authenticate, async (req, res) => {
  const { question, answer, category } = req.body;
  const ownerId = resolveOwnerId(req.user);
  const faq = await prisma.faq.findFirst({
    where: { id: req.params.id, userId: ownerId },
  });
  if (!faq) return res.status(404).json({ error: 'FAQ not found' });

  const updated = await prisma.faq.update({
    where: { id: req.params.id },
    data: { question, answer, category },
  });

  // Re-embed since content changed
  storeFaqEmbedding(updated.id, updated.question, updated.answer);

  res.json({ faq: updated });
});

// ── DELETE /api/ai-training/faqs/:id ─────────────────────────────────
router.delete('/faqs/:id', authenticate, async (req, res) => {
  const ownerId = resolveOwnerId(req.user);
  const faq = await prisma.faq.findFirst({
    where: { id: req.params.id, userId: ownerId },
  });
  if (!faq) return res.status(404).json({ error: 'FAQ not found' });
  await prisma.faq.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── POST /api/ai-training/faqs/backfill ──────────────────────────────
// One-time endpoint to embed all existing FAQs that have no embedding yet
router.post('/faqs/backfill', authenticate, async (req, res) => {
  const { backfillEmbeddings } = await import('../services/embeddings.js');
  backfillEmbeddings().catch(err => console.error('[Backfill]', err.message));
  res.json({ message: 'Backfill started in background' });
});

// ── GET /api/ai-training/settings ────────────────────────────────────
router.get('/settings', authenticate, async (req, res) => {
  const ownerId = resolveOwnerId(req.user);
  let settings = await prisma.aiSettings.findUnique({
    where: { userId: ownerId },
  });
  if (!settings) {
    settings = await prisma.aiSettings.create({
      data: { userId: ownerId, tones: ['friendly'], automations: [] },
    });
  }
  res.json({ settings });
});

// ── PUT /api/ai-training/settings ────────────────────────────────────
router.put('/settings', authenticate, async (req, res) => {
  const ownerId = resolveOwnerId(req.user);
  const { tones, automations } = req.body;
  const settings = await prisma.aiSettings.upsert({
    where: { userId: ownerId },
    update: {
      ...(tones !== undefined && { tones }),
      ...(automations !== undefined && { automations }),
    },
    create: {
      userId: ownerId,
      tones: tones || ['friendly'],
      automations: automations || [],
    },
  });
  res.json({ settings });
});

export default router;
