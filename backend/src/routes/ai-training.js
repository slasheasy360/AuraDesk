import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import prisma from '../utils/prisma.js';
import { storeFaqEmbedding, chunkText, storeFileChunkEmbeddings } from '../services/embeddings.js';
import { extractText } from '../services/fileProcessor.js';
import { uploadFile, getPresignedUrl, deleteFile } from '../utils/s3.js';
import { clearUserQueryCache } from './ai.js';

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
  clearUserQueryCache(ownerId);

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
  clearUserQueryCache(ownerId);

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
  clearUserQueryCache(ownerId);
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
      console.warn('[AI Training] No file provided');
      return res.status(400).json({ error: 'No file provided' });
    }

    const { mimetype, originalname, buffer, size } = req.file;

    // Validate file type
    if (mimetype !== 'application/pdf' && mimetype !== 'text/plain') {
      console.warn(`[AI Training] Unsupported file type: ${mimetype}`);
      return res.status(400).json({ error: 'Only PDF and TXT files are supported' });
    }

    // Validate file size (25MB cap from middleware)
    if (size > 25 * 1024 * 1024) {
      console.warn(`[AI Training] File size exceeds limit: ${size}`);
      return res.status(400).json({ error: 'File exceeds 25MB limit' });
    }

    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const s3Key = `ai-training/${ownerId}/${fileId}-${originalname}`;

    console.log(`[AI Training] Generated fileId: ${fileId}`);
    console.log(`[AI Training] Uploading to S3: ${s3Key}`);
    // Upload to S3
    try {
      await uploadFile(s3Key, buffer, mimetype);
      console.log(`[AI Training] S3 upload successful: ${s3Key}`);
    } catch (s3Err) {
      console.warn(`[AI Training] S3 upload failed (non-blocking): ${s3Err.message}`);
      // Continue anyway for testing
    }

    console.log(`[AI Training] Creating DB record for ${fileId}`);
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
    console.error('[AI Training] File upload failed:', err);
    res.status(500).json({ error: 'File upload failed', details: err.message });
  }
});

// ── GET /api/ai-training/files ───────────────────────────────────────
// List all training files for the owner
router.get('/files', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const files = await prisma.trainingFile.findMany({
      where: { userId: ownerId },
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

    // Delete from S3 (non-blocking — continue even if fails)
    try {
      await deleteFile(file.s3Key);
      console.log(`[AI Training] S3 deletion successful: ${file.s3Key}`);
    } catch (s3Err) {
      console.warn(`[AI Training] S3 deletion failed (non-blocking): ${s3Err.message}`);
      // Continue with DB deletion anyway
    }

    // Explicitly delete chunks first (belt-and-suspenders over DB cascade)
    await prisma.$executeRaw`DELETE FROM "file_chunks" WHERE "file_id" = ${req.params.id}`;

    // Delete the training file record
    await prisma.trainingFile.delete({
      where: { id: req.params.id },
    });

    clearUserQueryCache(ownerId);
    console.log(`[AI Training] File deleted from DB: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[AI Training] Delete file failed:', err.message);
    res.status(500).json({ error: 'Failed to delete file', details: err.message });
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
    console.log(`[AI Training] Extracting text from ${fileId} (mimeType: ${mimeType}, bufferSize: ${buffer.length})`);
    let text;
    try {
      text = await extractText(buffer, mimeType);
    } catch (extractErr) {
      console.error(`[AI Training] Text extraction failed for ${fileId}:`, extractErr.message);
      throw extractErr;
    }
    console.log(`[AI Training] Extracted ${text.length} characters from ${fileId}`);

    if (!text || text.trim().length === 0) {
      throw new Error('Extracted text is empty');
    }

    // Chunk text
    let chunks;
    try {
      chunks = chunkText(text);
    } catch (chunkErr) {
      console.error(`[AI Training] Text chunking failed for ${fileId}:`, chunkErr.message);
      throw chunkErr;
    }
    console.log(`[AI Training] Split into ${chunks.length} chunk(s) for ${fileId}`);

    if (chunks.length === 0) {
      throw new Error('No chunks generated from text');
    }

    // Store chunks with embeddings
    console.log(`[AI Training] Storing ${chunks.length} chunks with embeddings for ${fileId}`);
    try {
      await storeFileChunkEmbeddings(fileId, ownerId, chunks);
    } catch (storeErr) {
      console.error(`[AI Training] Embedding storage failed for ${fileId}:`, storeErr.message);
      throw storeErr;
    }

    // Update status to "ready"
    await prisma.trainingFile.update({
      where: { id: fileId },
      data: { status: 'ready' },
    });

    console.log(`[AI Training] File processing complete: ${fileId}`);
  } catch (err) {
    console.error(`[AI Training] Processing failed for ${fileId}:`, err.message);
    console.error(`[AI Training] Full error:`, err);
    await prisma.trainingFile.update({
      where: { id: fileId },
      data: { status: 'error', errorMsg: err.message },
    }).catch(updateErr => {
      console.error(`[AI Training] Failed to update error status for ${fileId}:`, updateErr.message);
    });
  }
}

export default router;
