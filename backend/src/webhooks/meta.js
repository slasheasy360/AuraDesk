import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma.js';
import { decrypt } from '../utils/encryption.js';

const router = Router();

// ── Webhook verification (GET) — Meta sends this when you register/verify webhook ──
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[Meta Webhook] Verification request', { mode, hasToken: Boolean(token), hasChallenge: Boolean(challenge) });

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log('[Meta Webhook] ✓ Verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('[Meta Webhook] ✗ Verification failed — token mismatch');
  res.sendStatus(403);
});

// ── Webhook handler (POST) — receives messages from Facebook, Instagram, WhatsApp ──
router.post('/', async (req, res) => {
  // MUST respond 200 within 5 seconds or Meta will retry
  res.sendStatus(200);

  try {
    const rawBody = req.body; // Buffer from express.raw()
    const signature = req.headers['x-hub-signature-256'];

    // Validate signature
    if (!validateSignature(rawBody, signature)) {
      console.error('[Meta Webhook] ✗ Invalid webhook signature — rejecting payload');
      return;
    }

    const payload = JSON.parse(rawBody.toString());
    const platform = mapObjectToPlatform(payload.object);

    console.log('[Meta Webhook] Received event', {
      object: payload.object,
      platform,
      entryCount: payload.entry?.length || 0,
    });

    // Log raw webhook event
    await prisma.webhookEventLog.create({
      data: {
        platform,
        payload,
        processed: false,
      },
    });

    // Process asynchronously
    processWebhookAsync(payload, req.app.get('io')).catch((err) => {
      console.error('[Meta Webhook] Processing error:', err.message, err.stack);
    });
  } catch (err) {
    console.error('[Meta Webhook] Receive error:', err.message, err.stack);
  }
});

function validateSignature(rawBody, signature) {
  if (!signature) {
    console.warn('[Meta Webhook] No x-hub-signature-256 header');
    return false;
  }
  if (!process.env.META_APP_SECRET) {
    console.error('[Meta Webhook] META_APP_SECRET not set — cannot validate signature');
    return false;
  }
  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(rawBody)
      .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

function mapObjectToPlatform(object) {
  switch (object) {
    case 'page':
      return 'facebook';
    case 'instagram':
      return 'instagram';
    case 'whatsapp_business_account':
      return 'whatsapp';
    default:
      console.warn('[Meta Webhook] Unknown object type:', object);
      return 'facebook';
  }
}

async function processWebhookAsync(payload, io) {
  const object = payload.object;

  if (object === 'page') {
    await processMessengerWebhook(payload, io);
  } else if (object === 'instagram') {
    await processInstagramWebhook(payload, io);
  } else if (object === 'whatsapp_business_account') {
    await processWhatsAppWebhook(payload, io);
  }

  // Mark as processed
  // (best-effort — find recent unprocessed log for this payload)
}

async function processMessengerWebhook(payload, io) {
  for (const entry of payload.entry || []) {
    const pageId = entry.id;

    if (!entry.messaging || entry.messaging.length === 0) {
      console.log('[Messenger Webhook] Entry has no messaging events', { pageId });
      continue;
    }

    for (const event of entry.messaging) {
      if (!event.message) {
        console.log('[Messenger Webhook] Non-message event (read/delivery/postback)', {
          pageId,
          keys: Object.keys(event),
        });
        continue;
      }

      const senderId = event.sender.id;
      if (senderId === pageId) continue; // Skip echo (messages sent by the page)

      console.log('[Messenger Webhook] Processing message', {
        pageId,
        senderId,
        messageId: event.message.mid,
        text: event.message.text?.substring(0, 50) || '[no text]',
      });

      // Find connected account by page ID
      const account = await prisma.connectedAccount.findFirst({
        where: { platform: 'facebook', platformAccountId: pageId, status: 'active' },
        include: { user: true },
      });

      if (!account) {
        console.warn('[Messenger Webhook] No connected account found for pageId:', pageId);
        continue;
      }

      // Upsert contact
      const contact = await prisma.contact.upsert({
        where: {
          userId_platform_platformUserId: {
            userId: account.userId,
            platform: 'facebook',
            platformUserId: senderId,
          },
        },
        update: {},
        create: {
          userId: account.userId,
          platform: 'facebook',
          platformUserId: senderId,
          name: `FB User ${senderId.slice(-4)}`,
        },
      });

      // Upsert conversation
      const conversation = await prisma.conversation.upsert({
        where: {
          connectedAccountId_platformConversationId: {
            connectedAccountId: account.id,
            platformConversationId: senderId,
          },
        },
        update: {
          lastMessageAt: new Date(),
          unreadCount: { increment: 1 },
        },
        create: {
          connectedAccountId: account.id,
          platformConversationId: senderId,
          contactId: contact.id,
          lastMessageAt: new Date(),
          unreadCount: 1,
        },
      });

      // Create message
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          platformMessageId: event.message.mid,
          direction: 'inbound',
          sender: contact.name,
          content: event.message.text || '',
          contentType: event.message.attachments ? 'image' : 'text',
          status: 'delivered',
          rawPayload: event,
        },
      });

      console.log('[Messenger Webhook] ✓ Message saved', {
        messageId: message.id,
        conversationId: conversation.id,
        userId: account.userId,
      });

      // Emit socket events to user
      io.to(`user:${account.userId}`).emit('new_message', {
        message,
        conversationId: conversation.id,
        platform: 'facebook',
      });

      io.to(`user:${account.userId}`).emit('conversation_update', {
        conversationId: conversation.id,
        lastMessageAt: new Date(),
        unreadCount: conversation.unreadCount,
      });
    }
  }
}

async function processInstagramWebhook(payload, io) {
  for (const entry of payload.entry || []) {
    if (!entry.messaging || entry.messaging.length === 0) {
      console.log('[Instagram Webhook] Entry has no messaging events', { entryId: entry.id });
      continue;
    }

    for (const event of entry.messaging) {
      if (!event.message) continue;

      const senderId = event.sender.id;
      const recipientId = event.recipient.id;

      console.log('[Instagram Webhook] Processing message', {
        senderId,
        recipientId,
        messageId: event.message.mid,
        text: event.message.text?.substring(0, 50) || '[no text]',
      });

      // Find connected Instagram account by IG Business Account ID
      const account = await prisma.connectedAccount.findFirst({
        where: { platform: 'instagram', platformAccountId: recipientId, status: 'active' },
        include: { user: true },
      });

      if (!account) {
        console.warn('[Instagram Webhook] No connected account for recipientId:', recipientId);
        continue;
      }

      // Upsert contact
      const contact = await prisma.contact.upsert({
        where: {
          userId_platform_platformUserId: {
            userId: account.userId,
            platform: 'instagram',
            platformUserId: senderId,
          },
        },
        update: {},
        create: {
          userId: account.userId,
          platform: 'instagram',
          platformUserId: senderId,
          name: `IG User ${senderId.slice(-4)}`,
        },
      });

      // Upsert conversation
      const conversation = await prisma.conversation.upsert({
        where: {
          connectedAccountId_platformConversationId: {
            connectedAccountId: account.id,
            platformConversationId: senderId,
          },
        },
        update: {
          lastMessageAt: new Date(),
          unreadCount: { increment: 1 },
        },
        create: {
          connectedAccountId: account.id,
          platformConversationId: senderId,
          contactId: contact.id,
          lastMessageAt: new Date(),
          unreadCount: 1,
        },
      });

      // Create message
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          platformMessageId: event.message.mid,
          direction: 'inbound',
          sender: contact.name,
          content: event.message.text || '',
          contentType: 'text',
          status: 'delivered',
          rawPayload: event,
        },
      });

      console.log('[Instagram Webhook] ✓ Message saved', {
        messageId: message.id,
        conversationId: conversation.id,
      });

      io.to(`user:${account.userId}`).emit('new_message', {
        message,
        conversationId: conversation.id,
        platform: 'instagram',
      });

      io.to(`user:${account.userId}`).emit('conversation_update', {
        conversationId: conversation.id,
        lastMessageAt: new Date(),
        unreadCount: conversation.unreadCount,
      });
    }
  }
}

async function processWhatsAppWebhook(payload, io) {
  for (const entry of payload.entry || []) {
    const changes = entry.changes || [];

    for (const change of changes) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;

      if (!value.messages) continue;

      console.log('[WhatsApp Webhook] Processing messages', {
        phoneNumberId,
        messageCount: value.messages.length,
      });

      const waAccount = await prisma.whatsappAccount.findFirst({
        where: { phoneNumberId },
        include: {
          connectedAccount: { include: { user: true } },
        },
      });

      if (!waAccount) {
        console.warn('[WhatsApp Webhook] No account for phoneNumberId:', phoneNumberId);
        continue;
      }

      const account = waAccount.connectedAccount;

      for (const msg of value.messages) {
        const senderPhone = msg.from;
        const contactName =
          value.contacts?.find((c) => c.wa_id === senderPhone)?.profile?.name || senderPhone;

        const contact = await prisma.contact.upsert({
          where: {
            userId_platform_platformUserId: {
              userId: account.userId,
              platform: 'whatsapp',
              platformUserId: senderPhone,
            },
          },
          update: { name: contactName },
          create: {
            userId: account.userId,
            platform: 'whatsapp',
            platformUserId: senderPhone,
            name: contactName,
          },
        });

        const conversation = await prisma.conversation.upsert({
          where: {
            connectedAccountId_platformConversationId: {
              connectedAccountId: account.id,
              platformConversationId: senderPhone,
            },
          },
          update: {
            lastMessageAt: new Date(),
            unreadCount: { increment: 1 },
          },
          create: {
            connectedAccountId: account.id,
            platformConversationId: senderPhone,
            contactId: contact.id,
            lastMessageAt: new Date(),
            unreadCount: 1,
          },
        });

        const message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            platformMessageId: msg.id,
            direction: 'inbound',
            sender: contactName,
            content: msg.text?.body || msg.caption || '[Media]',
            contentType: msg.type === 'text' ? 'text' : msg.type,
            status: 'delivered',
            rawPayload: msg,
          },
        });

        console.log('[WhatsApp Webhook] ✓ Message saved', {
          messageId: message.id,
          from: senderPhone,
        });

        io.to(`user:${account.userId}`).emit('new_message', {
          message,
          conversationId: conversation.id,
          platform: 'whatsapp',
        });

        io.to(`user:${account.userId}`).emit('conversation_update', {
          conversationId: conversation.id,
          lastMessageAt: new Date(),
          unreadCount: conversation.unreadCount,
        });
      }
    }
  }
}

export default router;
