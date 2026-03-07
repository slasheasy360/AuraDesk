import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma.js';
import { decrypt } from '../utils/encryption.js';

const router = Router();

// Webhook verification (GET) — Meta sends this when you register/verify webhook
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log('Meta webhook verified');
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Webhook handler (POST) — receives messages from Facebook, Instagram, WhatsApp
router.post('/', async (req, res) => {
  // MUST respond 200 within 5 seconds
  res.sendStatus(200);

  try {
    const rawBody = req.body; // Buffer from express.raw()
    const signature = req.headers['x-hub-signature-256'];

    // Validate signature
    if (!validateSignature(rawBody, signature)) {
      console.error('Invalid webhook signature');
      return;
    }

    const payload = JSON.parse(rawBody.toString());

    // Log raw webhook event immediately
    await prisma.webhookEventLog.create({
      data: {
        platform: mapObjectToPlatform(payload.object),
        payload,
        processed: false,
      },
    });

    // Process asynchronously
    processWebhookAsync(payload, req.app.get('io')).catch((err) => {
      console.error('Webhook processing error:', err);
    });
  } catch (err) {
    console.error('Webhook receive error:', err);
  }
});

function validateSignature(rawBody, signature) {
  if (!signature) return false;
  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(rawBody)
      .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
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
}

async function processMessengerWebhook(payload, io) {
  for (const entry of payload.entry || []) {
    const pageId = entry.id;

    for (const event of entry.messaging || []) {
      if (!event.message) continue;

      const senderId = event.sender.id;
      if (senderId === pageId) continue; // Skip messages sent by the page itself

      // Find connected account by page ID
      const account = await prisma.connectedAccount.findFirst({
        where: { platform: 'facebook', platformAccountId: pageId, status: 'active' },
        include: { user: true },
      });

      if (!account) continue;

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
          content: event.message.text || '',
          contentType: event.message.attachments ? 'image' : 'text',
          status: 'delivered',
          rawPayload: event,
        },
      });

      // Emit socket event to user
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
    for (const event of entry.messaging || []) {
      if (!event.message) continue;

      const senderId = event.sender.id;
      const recipientId = event.recipient.id;

      // Find connected Instagram account by IG Business Account ID
      const account = await prisma.connectedAccount.findFirst({
        where: { platform: 'instagram', platformAccountId: recipientId, status: 'active' },
        include: { user: true },
      });

      if (!account) continue;

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
          content: event.message.text || '',
          contentType: 'text',
          status: 'delivered',
          rawPayload: event,
        },
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

      // Find WhatsApp account by phone number ID
      const waAccount = await prisma.whatsappAccount.findFirst({
        where: { phoneNumberId },
        include: {
          connectedAccount: { include: { user: true } },
        },
      });

      if (!waAccount) continue;

      const account = waAccount.connectedAccount;

      for (const msg of value.messages) {
        const senderPhone = msg.from;
        const contactName =
          value.contacts?.find((c) => c.wa_id === senderPhone)?.profile?.name || senderPhone;

        // Upsert contact
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

        // Upsert conversation
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

        // Create message
        const message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            platformMessageId: msg.id,
            direction: 'inbound',
            content: msg.text?.body || msg.caption || '[Media]',
            contentType: msg.type === 'text' ? 'text' : msg.type,
            status: 'delivered',
            rawPayload: msg,
          },
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
