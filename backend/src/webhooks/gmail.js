import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { processGmailHistory } from '../services/gmail.pubsub.js';

const router = Router();

/**
 * POST /webhooks/gmail
 *
 * Receives Google Pub/Sub push notifications when new Gmail messages arrive.
 * Pub/Sub sends a JSON body with:
 * {
 *   "message": {
 *     "data": "<base64-encoded JSON: { emailAddress, historyId }>",
 *     "messageId": "...",
 *     "publishTime": "..."
 *   },
 *   "subscription": "..."
 * }
 *
 * MUST respond 200 quickly to avoid Pub/Sub retries.
 */
router.post('/', async (req, res) => {
  // Acknowledge immediately — Pub/Sub requires a fast 200
  res.sendStatus(200);

  try {
    const rawBody = req.body;
    const payload = JSON.parse(rawBody.toString());

    // Log the webhook event
    await prisma.webhookEventLog.create({
      data: {
        platform: 'gmail',
        payload,
        processed: false,
      },
    });

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

    // Process new messages via History API
    const io = req.app.get('io');
    await processGmailHistory(account, io);
  } catch (err) {
    console.error('[Gmail Webhook] Processing error:', err);
  }
});

export default router;
