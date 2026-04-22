import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import prisma from '../utils/prisma.js';
import { storeFaqEmbedding, chunkText, storeFileChunkEmbeddings } from '../services/embeddings.js';
import { extractText } from '../services/fileProcessor.js';
import { uploadFile, getPresignedUrl, deleteFile } from '../utils/s3.js';

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

// ── POST /api/ai-training/files ──────────────────────────────────────
// Upload a training file (PDF or TXT), store in S3, create DB record
router.post('/files', authenticate, upload.single('file'), async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { mimetype, originalname, buffer, size } = req.file;

    // Validate file type
    if (mimetype !== 'application/pdf' && mimetype !== 'text/plain') {
      return res.status(400).json({ error: 'Only PDF and TXT files are supported' });
    }

    // Validate file size (25MB cap from middleware)
    if (size > 25 * 1024 * 1024) {
      return res.status(400).json({ error: 'File exceeds 25MB limit' });
    }

    const fileId = uuid();
    const s3Key = `ai-training/${ownerId}/${fileId}-${originalname}`;

    // Upload to S3
    await uploadFile(s3Key, buffer, mimetype);

    // Create DB record with "pending" status
    const trainingFile = await prisma.trainingFile.create({
      data: {
        id: fileId,
        userId: ownerId,
        filename: originalname,
        mimeType: mimetype,
        sizeBytes: size,
        s3Key,
        status: 'pending',
        uploadedBy: req.user.id,
      },
    });

    console.log(`[AI Training] File uploaded: ${fileId} (${originalname})`);

    // Process file asynchronously in background
    processFile(fileId, buffer, mimetype, ownerId).catch((err) => {
      console.error(`[AI Training] File processing failed for ${fileId}:`, err.message);
    });

    res.status(201).json({ file: trainingFile });
  } catch (err) {
    console.error('[AI Training] File upload failed:', err.message);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// ── GET /api/ai-training/files ───────────────────────────────────────
// List all training files for the owner
router.get('/files', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const files = await prisma.trainingFile.findMany({
      where: { userId: ownerId },
      include: { uploadedByUser: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ files });
  } catch (err) {
    console.error('[AI Training] Get files failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// ── GET /api/ai-training/files/:id/url ───────────────────────────────
// Get a presigned URL for downloading the file
router.get('/files/:id/url', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const file = await prisma.trainingFile.findFirst({
      where: { id: req.params.id, userId: ownerId },
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const presignedUrl = await getPresignedUrl(file.s3Key, 300); // 5-minute expiry
    res.json({ url: presignedUrl });
  } catch (err) {
    console.error('[AI Training] Get presigned URL failed:', err.message);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// ── DELETE /api/ai-training/files/:id ────────────────────────────────
// Delete a training file from S3 and database (cascade deletes chunks)
router.delete('/files/:id', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const file = await prisma.trainingFile.findFirst({
      where: { id: req.params.id, userId: ownerId },
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete from S3
    await deleteFile(file.s3Key);

    // Delete from DB (cascade deletes chunks)
    await prisma.trainingFile.delete({
      where: { id: req.params.id },
    });

    console.log(`[AI Training] File deleted: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[AI Training] Delete file failed:', err.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ── Background: Process file (extract text, chunk, embed) ──────────────
async function processFile(fileId, buffer, mimeType, ownerId) {
  try {
    // Update status to "processing"
    await prisma.trainingFile.update({
      where: { id: fileId },
      data: { status: 'processing' },
    });

    console.log(`[AI Training] Processing file: ${fileId}`);

    // Extract text
    const text = await extractText(buffer, mimeType);
    console.log(`[AI Training] Extracted ${text.length} characters from ${fileId}`);

    // Chunk text
    const chunks = chunkText(text);
    console.log(`[AI Training] Split into ${chunks.length} chunk(s) for ${fileId}`);

    // Store chunks with embeddings
    await storeFileChunkEmbeddings(fileId, ownerId, chunks);

    // Update status to "ready"
    await prisma.trainingFile.update({
      where: { id: fileId },
      data: { status: 'ready' },
    });

    console.log(`[AI Training] File processing complete: ${fileId}`);
  } catch (err) {
    console.error(`[AI Training] Processing failed for ${fileId}:`, err.message);
    await prisma.trainingFile.update({
      where: { id: fileId },
      data: { status: 'error', errorMsg: err.message },
    });
  }
}

export default router;
