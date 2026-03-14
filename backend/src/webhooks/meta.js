import { Router } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import prisma from '../utils/prisma.js';
import { decrypt } from '../utils/encryption.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

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

      // Find connected account by page ID (prefer most recently connected, must have auth token)
      const account = await prisma.connectedAccount.findFirst({
        where: {
          platform: 'facebook',
          platformAccountId: pageId,
          status: 'active',
          authToken: { isNot: null },
        },
        include: { user: true, authToken: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!account) {
        console.warn('[Messenger Webhook] No connected account found for pageId:', pageId);
        continue;
      }

      // Fetch real user profile from Graph API
      let contactName = `FB User ${senderId.slice(-4)}`;
      let avatarUrl = null;
      if (account.authToken) {
        try {
          const pageToken = decrypt(account.authToken.accessTokenEncrypted);
          const profileRes = await axios.get(`${GRAPH_API}/${senderId}`, {
            params: { fields: 'first_name,last_name,profile_pic', access_token: pageToken },
          });
          const profile = profileRes.data;
          if (profile.first_name || profile.last_name) {
            contactName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
          }
          avatarUrl = profile.profile_pic || null;
        } catch (profileErr) {
          console.warn('[Messenger Webhook] Could not fetch user profile:', profileErr.response?.data?.error?.message || profileErr.message);
        }
      }

      // Upsert contact with real name
      const contact = await prisma.contact.upsert({
        where: {
          userId_platform_platformUserId: {
            userId: account.userId,
            platform: 'facebook',
            platformUserId: senderId,
          },
        },
        update: { name: contactName, avatarUrl },
        create: {
          userId: account.userId,
          platform: 'facebook',
          platformUserId: senderId,
          name: contactName,
          avatarUrl,
        },
      });

      // Extract attachments from webhook payload
      const incomingAttachments = [];
      if (event.message.attachments && Array.isArray(event.message.attachments)) {
        for (const att of event.message.attachments) {
          incomingAttachments.push({
            filename: att.payload?.title || `attachment_${Date.now()}`,
            mimeType: att.type === 'image' ? 'image/jpeg'
              : att.type === 'video' ? 'video/mp4'
              : att.type === 'audio' ? 'audio/mpeg'
              : 'application/octet-stream',
            size: att.payload?.size || 0,
            fileUrl: att.payload?.url || null,
            type: att.type,
          });
        }
      }

      // Determine content type from attachments
      let contentType = 'text';
      if (incomingAttachments.length > 0) {
        const firstType = incomingAttachments[0].type;
        if (firstType === 'image') contentType = 'image';
        else if (firstType === 'video') contentType = 'video';
        else if (firstType === 'audio') contentType = 'audio';
        else contentType = 'file';
      }

      // Skip messages with a timestamp older than the account connection time
      const fbMsgTimestamp = event.timestamp ? new Date(event.timestamp) : null;
      if (fbMsgTimestamp && fbMsgTimestamp < new Date(account.createdAt)) {
        console.log('[Messenger Webhook] Skipping pre-connection message:', event.message.mid);
        continue;
      }

      // Deduplicate: Meta webhooks use at-least-once delivery
      const existingMsg = await prisma.message.findFirst({
        where: {
          platformMessageId: event.message.mid,
          conversation: { connectedAccountId: account.id },
        },
      });
      if (existingMsg) {
        console.log('[Messenger Webhook] Duplicate message skipped:', event.message.mid);
        continue;
      }

      // Upsert conversation WITHOUT incrementing unread (increment after message is confirmed new)
      const conversation = await prisma.conversation.upsert({
        where: {
          connectedAccountId_platformConversationId: {
            connectedAccountId: account.id,
            platformConversationId: senderId,
          },
        },
        update: {
          lastMessageAt: new Date(),
        },
        create: {
          connectedAccountId: account.id,
          platformConversationId: senderId,
          contactId: contact.id,
          lastMessageAt: new Date(),
          unreadCount: 0,
        },
      });

      // Create message with attachments
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          platformMessageId: event.message.mid,
          direction: 'inbound',
          sender: contact.name,
          content: event.message.text || (incomingAttachments.length > 0 ? `[${incomingAttachments[0].type || 'Media'}]` : ''),
          contentType,
          attachments: incomingAttachments.length > 0 ? incomingAttachments : undefined,
          status: 'delivered',
          rawPayload: event,
        },
      });

      // Increment unread count AFTER message is confirmed new
      const updatedConversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { unreadCount: { increment: 1 } },
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
        unreadCount: updatedConversation.unreadCount,
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

      // Find connected Instagram account — try recipientId first (inbound), then senderId (echo/outbound)
      // Prefer most recently connected account with a valid auth token
      let account = await prisma.connectedAccount.findFirst({
        where: {
          platform: 'instagram',
          platformAccountId: recipientId,
          status: 'active',
          authToken: { isNot: null },
        },
        include: { user: true, authToken: true },
        orderBy: { createdAt: 'desc' },
      });

      // If not found by recipientId, this might be an echo (outbound) — sender is our account
      if (!account) {
        account = await prisma.connectedAccount.findFirst({
          where: {
            platform: 'instagram',
            platformAccountId: senderId,
            status: 'active',
            authToken: { isNot: null },
          },
          include: { user: true, authToken: true },
          orderBy: { createdAt: 'desc' },
        });
        if (account) {
          // This is an echo of our own outbound message — skip it
          console.log('[Instagram Webhook] Skipping echo/outbound message from our account');
          continue;
        }
        console.warn('[Instagram Webhook] No connected account for recipientId:', recipientId, 'or senderId:', senderId);
        continue;
      }

      // Fetch real Instagram username via Graph API
      let contactName = `IG User ${senderId.slice(-4)}`;
      let igUsername = null;
      let avatarUrl = null;
      if (account.authToken) {
        try {
          const pageToken = decrypt(account.authToken.accessTokenEncrypted);
          const profileRes = await axios.get(`${GRAPH_API}/${senderId}`, {
            params: { fields: 'name,username,profile_pic', access_token: pageToken },
          });
          const profile = profileRes.data;
          igUsername = profile.username || null;
          contactName = profile.username || profile.name || contactName;
          avatarUrl = profile.profile_pic || null;
        } catch (profileErr) {
          console.warn('[Instagram Webhook] Could not fetch IG user profile:', profileErr.response?.data?.error?.message || profileErr.message);
        }
      }

      // Upsert contact with real username
      const contact = await prisma.contact.upsert({
        where: {
          userId_platform_platformUserId: {
            userId: account.userId,
            platform: 'instagram',
            platformUserId: senderId,
          },
        },
        update: { name: contactName, username: igUsername, avatarUrl },
        create: {
          userId: account.userId,
          platform: 'instagram',
          platformUserId: senderId,
          name: contactName,
          username: igUsername,
          avatarUrl,
        },
      });

      // Extract attachments from Instagram webhook payload
      const igAttachments = [];
      if (event.message.attachments && Array.isArray(event.message.attachments)) {
        for (const att of event.message.attachments) {
          igAttachments.push({
            filename: att.payload?.title || `ig_attachment_${Date.now()}`,
            mimeType: att.type === 'image' ? 'image/jpeg'
              : att.type === 'video' ? 'video/mp4'
              : att.type === 'audio' ? 'audio/mpeg'
              : 'application/octet-stream',
            size: att.payload?.size || 0,
            fileUrl: att.payload?.url || null,
            type: att.type,
          });
        }
      }

      // Determine content type
      let igContentType = 'text';
      if (igAttachments.length > 0) {
        const firstType = igAttachments[0].type;
        if (firstType === 'image') igContentType = 'image';
        else if (firstType === 'video') igContentType = 'video';
        else if (firstType === 'audio') igContentType = 'audio';
        else igContentType = 'file';
      }

      // Skip messages with a timestamp older than the account connection time
      const igMsgTimestamp = event.timestamp ? new Date(event.timestamp) : null;
      if (igMsgTimestamp && igMsgTimestamp < new Date(account.createdAt)) {
        console.log('[Instagram Webhook] Skipping pre-connection message:', event.message.mid);
        continue;
      }

      // Deduplicate: Meta webhooks use at-least-once delivery
      const existingMsg = await prisma.message.findFirst({
        where: {
          platformMessageId: event.message.mid,
          conversation: { connectedAccountId: account.id },
        },
      });
      if (existingMsg) {
        console.log('[Instagram Webhook] Duplicate message skipped:', event.message.mid);
        continue;
      }

      // Upsert conversation WITHOUT incrementing unread (increment after message is confirmed new)
      const conversation = await prisma.conversation.upsert({
        where: {
          connectedAccountId_platformConversationId: {
            connectedAccountId: account.id,
            platformConversationId: senderId,
          },
        },
        update: {
          lastMessageAt: new Date(),
        },
        create: {
          connectedAccountId: account.id,
          platformConversationId: senderId,
          contactId: contact.id,
          lastMessageAt: new Date(),
          unreadCount: 0,
        },
      });

      // Create message with attachments
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          platformMessageId: event.message.mid,
          direction: 'inbound',
          sender: contact.name,
          content: event.message.text || (igAttachments.length > 0 ? `[${igAttachments[0].type || 'Media'}]` : ''),
          contentType: igContentType,
          attachments: igAttachments.length > 0 ? igAttachments : undefined,
          status: 'delivered',
          rawPayload: event,
        },
      });

      // Increment unread count AFTER message is confirmed new
      const updatedConversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { unreadCount: { increment: 1 } },
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
        unreadCount: updatedConversation.unreadCount,
      });
    }
  }
}

async function processWhatsAppWebhook(payload, io) {
  for (const entry of payload.entry || []) {
    const wabaId = entry.id; // The WABA ID from the webhook entry
    const changes = entry.changes || [];

    for (const change of changes) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;

      // Handle message status updates (sent -> delivered -> read)
      if (value.statuses) {
        for (const status of value.statuses) {
          const statusMap = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
          const mappedStatus = statusMap[status.status];
          if (!mappedStatus) continue;

          try {
            const msg = await prisma.message.findFirst({
              where: { platformMessageId: status.id },
            });
            if (msg) {
              const updateData = { status: mappedStatus };
              if (mappedStatus === 'delivered') updateData.deliveredAt = new Date(Number(status.timestamp) * 1000);
              if (mappedStatus === 'read') updateData.readAt = new Date(Number(status.timestamp) * 1000);
              await prisma.message.update({ where: { id: msg.id }, data: updateData });
              console.log('[WhatsApp Webhook] Status updated:', { messageId: msg.id, status: mappedStatus });
            }
          } catch (err) {
            console.warn('[WhatsApp Webhook] Failed to update status:', err.message);
          }
        }
      }

      if (!value.messages) continue;

      console.log('[WhatsApp Webhook] Processing messages', {
        wabaId,
        phoneNumberId,
        messageCount: value.messages.length,
      });

      // Route to correct tenant using both wabaId AND phoneNumberId for precise multi-tenant matching
      const waAccount = await prisma.whatsappAccount.findFirst({
        where: {
          phoneNumberId,
          ...(wabaId ? { wabaId } : {}),
        },
        include: {
          connectedAccount: { include: { user: true } },
        },
      });

      if (!waAccount) {
        console.warn('[WhatsApp Webhook] No account for wabaId:', wabaId, 'phoneNumberId:', phoneNumberId);
        continue;
      }

      const account = waAccount.connectedAccount;

      for (const msg of value.messages) {
        // Skip messages with a timestamp older than the account connection time
        const waMsgTimestamp = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : null;
        if (waMsgTimestamp && waMsgTimestamp < new Date(account.createdAt)) {
          console.log('[WhatsApp Webhook] Skipping pre-connection message:', msg.id);
          continue;
        }

        // Deduplicate: Meta webhooks are at-least-once delivery
        const existingMsg = await prisma.message.findFirst({
          where: {
            platformMessageId: msg.id,
            conversation: { connectedAccountId: account.id },
          },
        });
        if (existingMsg) {
          console.log('[WhatsApp Webhook] Duplicate message skipped:', msg.id);
          continue;
        }

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

        // Upsert conversation WITHOUT incrementing unread (increment after message is confirmed new)
        const conversation = await prisma.conversation.upsert({
          where: {
            connectedAccountId_platformConversationId: {
              connectedAccountId: account.id,
              platformConversationId: senderPhone,
            },
          },
          update: {
            lastMessageAt: new Date(),
          },
          create: {
            connectedAccountId: account.id,
            platformConversationId: senderPhone,
            contactId: contact.id,
            lastMessageAt: new Date(),
            unreadCount: 0,
          },
        });

        // Extract WhatsApp media attachment metadata
        const waAttachments = [];
        const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker'];
        if (mediaTypes.includes(msg.type) && msg[msg.type]) {
          const media = msg[msg.type];
          waAttachments.push({
            filename: media.filename || `${msg.type}_${Date.now()}`,
            mimeType: media.mime_type || 'application/octet-stream',
            size: media.file_size || 0,
            mediaId: media.id,
            type: msg.type,
          });
        }

        const message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            platformMessageId: msg.id,
            direction: 'inbound',
            sender: contactName,
            content: msg.text?.body || msg[msg.type]?.caption || (waAttachments.length > 0 ? `[${msg.type || 'Media'}]` : ''),
            contentType: ['text', 'image', 'audio', 'video', 'file', 'sticker'].includes(msg.type) ? msg.type : 'file',
            attachments: waAttachments.length > 0 ? waAttachments : undefined,
            status: 'delivered',
            rawPayload: msg,
          },
        });

        // Increment unread count AFTER message is confirmed new
        const updatedConversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: { unreadCount: { increment: 1 } },
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
          unreadCount: updatedConversation.unreadCount,
        });
      }
    }
  }
}

export default router;
