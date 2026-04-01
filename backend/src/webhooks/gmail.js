import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { processGmailHistory } from '../services/gmail.pubsub.js';

const router = Router();

// ── Pub/Sub message deduplication ──────────────────────────────────────────
// Google Pub/Sub may deliver the same notification more than once.
// Track recently seen Pub/Sub messageIds in memory to skip duplicates.
const recentPubsubIds = new Map(); // messageId → timestamp
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodically prune expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of recentPubsubIds) {
    if (now - ts > DEDUP_TTL_MS) recentPubsubIds.delete(id);
  }
}, 5 * 60 * 1000);

/**
 * POST /webhooks/gmail
 *
 * Receives Google Pub/Sub push notifications when new Gmail messages arrive.
 * MUST respond 200 quickly to avoid Pub/Sub retries.
 */
router.post('/', async (req, res) => {
  // Acknowledge immediately — Pub/Sub requires a fast 200
  res.sendStatus(200);

  const t0 = Date.now();
  try {
    const rawBody = req.body;
    const payload = JSON.parse(rawBody.toString());

    // ── Deduplicate Pub/Sub deliveries ──
    const pubsubMessageId = payload.message?.messageId;
    if (pubsubMessageId) {
      if (recentPubsubIds.has(pubsubMessageId)) {
        console.log(`[Gmail Webhook] Duplicate Pub/Sub messageId=${pubsubMessageId}, skipping`);
        return;
      }
      recentPubsubIds.set(pubsubMessageId, Date.now());
    }

    // Log the webhook event
    const logEntry = await prisma.webhookEventLog.create({
      data: {
        platform: 'gmail',
        payload,
        processed: false,
      },
    });
    console.log(`[Gmail Webhook] Event logged id=${logEntry.id}, pubsubMsgId=${pubsubMessageId || 'none'}`);

    // Extract Pub/Sub message data
    const pubsubMessage = payload.message;
    if (!pubsubMessage?.data) {
      console.warn('[Gmail Webhook] No message.data in payload');
      return;
    }

    const decoded = JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString('utf8'));
    const { emailAddress, historyId } = decoded;

    if (!emailAddress || !historyId) {
      console.warn('[Gmail Webhook] Missing emailAddress or historyId:', decoded);
      return;
    }

    console.log(`[Gmail Webhook] Notification for ${emailAddress}, historyId=${historyId}`);

    // Find the connected Gmail account by email
    const account = await prisma.connectedAccount.findFirst({
      where: {
        platform: 'gmail',
        platformAccountId: emailAddress,
        status: 'active',
      },
      include: { user: true },
    });

    if (!account) {
      console.warn(`[Gmail Webhook] No active Gmail account found for ${emailAddress}`);
      return;
    }

    if (!account.gmailHistoryId) {
      console.warn(`[Gmail Webhook] No stored historyId for account ${account.id}, skipping`);
      return;
    }

    console.log(`[Gmail Webhook] Processing: account=${account.id}, storedHistoryId=${account.gmailHistoryId}, notificationHistoryId=${historyId}, latencySinceReceived=${Date.now() - t0}ms`);

    // Process new messages via History API.
    // processGmailHistory handles: per-account mutex, fresh DB reads,
    // empty-history retries, and 404 (expired historyId) recovery internally.
    const io = req.app.get('io');
    try {
      await processGmailHistory(account, io);
      await prisma.webhookEventLog.update({
        where: { id: logEntry.id },
        data: { processed: true },
      });
      console.log(`[Gmail Webhook] Successfully processed for ${emailAddress} (${Date.now() - t0}ms total)`);
    } catch (err) {
      console.error(`[Gmail Webhook] Processing failed for ${emailAddress} (${Date.now() - t0}ms):`, err.message);
      await prisma.webhookEventLog.update({
        where: { id: logEntry.id },
        data: { processed: false, error: err?.message || 'Unknown error' },
      });
    }
  } catch (err) {
    console.error('[Gmail Webhook] Processing error:', err);
  }
});

export default router;
