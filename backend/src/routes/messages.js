import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import prisma from '../utils/prisma.js';
import { uploadFile, getPresignedUrl } from '../utils/s3.js';
import * as facebookService from '../services/facebook.js';
import * as instagramService from '../services/instagram.js';
import * as whatsappService from '../services/whatsapp.js';
import * as gmailService from '../services/gmail.js';
import { syncGmailMessagesController, gmailDiagnosticController } from '../controllers/gmail.controller.js';
import { syncInstagramMessages } from '../services/instagram.sync.js';
import { syncFacebookMessages } from '../services/facebook.sync.js';
import axios from 'axios';

const router = Router();

function getMetaParticipantIds(rawPayload = {}) {
  const senderId = rawPayload.sender?.id || rawPayload.from?.id || null;
  const recipientId = rawPayload.recipient?.id || rawPayload.to?.data?.[0]?.id || null;
  return { senderId, recipientId };
}

async function resolveMetaRecipientId(conversation, platform) {
  if (conversation.contact?.platformUserId) return conversation.contact.platformUserId;

  const lastMsg = await prisma.message.findFirst({
    where: { conversationId: conversation.id, rawPayload: { not: null } },
    orderBy: { sentAt: 'desc' },
    select: { rawPayload: true },
  });

  const { senderId, recipientId } = getMetaParticipantIds(lastMsg?.rawPayload || {});
  const accountId = conversation.connectedAccount?.platformAccountId || null;
  let otherId = null;

  if (accountId) {
    if (senderId && senderId !== accountId) otherId = senderId;
    if (recipientId && recipientId !== accountId) otherId = recipientId;
  }

  if (!otherId) {
    if (senderId && recipientId && senderId !== recipientId) {
      otherId = senderId;
    }
  }

  if (!otherId) return null;

  const contact = await prisma.contact.upsert({
    where: {
      userId_platform_platformUserId: {
        userId: conversation.connectedAccount.userId,
        platform,
        platformUserId: otherId,
      },
    },
    update: {},
    create: {
      userId: conversation.connectedAccount.userId,
      platform,
      platformUserId: otherId,
      name: `${platform.toUpperCase()} User ${otherId.slice(-4)}`,
    },
  });

  if (!conversation.contactId) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { contactId: contact.id },
    });
  }

  return otherId;
}

// Get smart inbox messages across all connected platforms
router.get('/', authenticate, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: {
        conversation: {
          connectedAccount: {
            userId: req.user.id,
            status: 'active',
          },
        },
      },
      include: {
        conversation: {
          include: {
            contact: {
              select: {
                id: true,
                name: true,
                username: true,
                platformUserId: true,
              },
            },
            connectedAccount: {
              select: {
                id: true,
                platform: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: { sentAt: 'desc' },
    });

    const normalized = messages.map((message) => ({
      ...message,
      platform: message.conversation.connectedAccount.platform,
      sender:
        message.sender ||
        message.conversation.contact?.name ||
        message.conversation.contact?.username ||
        message.conversation.contact?.platformUserId ||
        'Unknown',
      subject: message.subject || null,
    }));

    res.json({ messages: normalized });
  } catch (err) {
    console.error('Get smart inbox messages error:', err);
    res.status(500).json({ error: 'Failed to fetch smart inbox messages' });
  }
});

// Diagnose Gmail API connectivity
router.get('/gmail/diagnose', authenticate, gmailDiagnosticController);

// Sync latest Gmail messages for the current user
router.get('/gmail/sync', authenticate, syncGmailMessagesController);

// Sync latest Instagram DM messages for the current user
router.get('/instagram/sync', authenticate, async (req, res) => {
  try {
    const messages = await syncInstagramMessages(req.user.id);
    const newCount = messages.filter((m) => m._isNew).length;
    res.json({
      success: true,
      synced: messages.length,
      newMessages: newCount,
    });
  } catch (err) {
    console.error('Instagram sync error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to sync Instagram messages',
    });
  }
});

// Sync latest Facebook Messenger messages for the current user
router.get('/facebook/sync', authenticate, async (req, res) => {
  try {
    const messages = await syncFacebookMessages(req.user.id);
    const newCount = messages.filter((m) => m._isNew).length;
    res.json({
      success: true,
      synced: messages.length,
      newMessages: newCount,
    });
  } catch (err) {
    console.error('Facebook sync error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to sync Facebook messages',
    });
  }
});

// Get messages for a conversation
router.get('/:conversationId', authenticate, async (req, res) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.conversationId,
        connectedAccount: { userId: req.user.id },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { sentAt: 'asc' },
    });

    res.json({ messages });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Download an attachment from a message
router.get('/:messageId/attachments/:index/download', authenticate, async (req, res) => {
  try {
    const { messageId, index } = req.params;
    const attIndex = parseInt(index, 10);

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversation: { connectedAccount: { userId: req.user.id } },
      },
      include: {
        conversation: { include: { connectedAccount: true } },
      },
    });

    if (!message) return res.status(404).json({ error: 'Message not found' });

    const attachments = message.attachments;
    if (!attachments || !Array.isArray(attachments) || attIndex < 0 || attIndex >= attachments.length) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const att = attachments[attIndex];
    const platform = message.conversation.connectedAccount.platform;
    const connectedAccountId = message.conversation.connectedAccountId;

    if (platform === 'whatsapp' && att.mediaId) {
      // WhatsApp: download via Graph API media endpoint
      const { stream, contentType, contentLength } = await whatsappService.downloadMedia(connectedAccountId, att.mediaId);
      res.setHeader('Content-Type', contentType || att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.filename || 'download')}"`);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      stream.pipe(res);
    } else if ((platform === 'facebook' || platform === 'instagram') && att.fileUrl) {
      // Facebook/Instagram: proxy the attachment URL
      const response = await axios.get(att.fileUrl, { responseType: 'stream' });
      res.setHeader('Content-Type', response.headers['content-type'] || att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.filename || 'download')}"`);
      if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
      response.data.pipe(res);
    } else if (platform === 'gmail' && att.attachmentId) {
      // Gmail: fetch attachment data via Gmail API
      const gmail = await gmailService.getGmailClient(connectedAccountId);
      const gmailMsgId = message.platformMessageId;
      const attRes = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: gmailMsgId,
        id: att.attachmentId,
      });
      const data = attRes.data.data; // base64url encoded
      const buffer = Buffer.from(data, 'base64url');
      res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.filename || 'download')}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } else if (att.s3Key) {
      // Outbound attachments stored in S3
      const url = await getPresignedUrl(att.s3Key);
      res.redirect(url);
    } else {
      return res.status(400).json({ error: 'Attachment cannot be downloaded — no media reference found' });
    }
  } catch (err) {
    console.error('Download attachment error:', err);
    res.status(500).json({ error: 'Failed to download attachment' });
  }
});

// Proxy attachment for inline preview (same as download but Content-Disposition: inline)
router.get('/:messageId/attachments/:index/preview', authenticate, async (req, res) => {
  try {
    const { messageId, index } = req.params;
    const attIndex = parseInt(index, 10);

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversation: { connectedAccount: { userId: req.user.id } },
      },
      include: {
        conversation: { include: { connectedAccount: true } },
      },
    });

    if (!message) return res.status(404).json({ error: 'Message not found' });

    const attachments = message.attachments;
    if (!attachments || !Array.isArray(attachments) || attIndex < 0 || attIndex >= attachments.length) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const att = attachments[attIndex];
    const platform = message.conversation.connectedAccount.platform;
    const connectedAccountId = message.conversation.connectedAccountId;

    // Set cache headers for previews
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (platform === 'whatsapp' && att.mediaId) {
      const { stream, contentType, contentLength } = await whatsappService.downloadMedia(connectedAccountId, att.mediaId);
      res.setHeader('Content-Type', contentType || att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      stream.pipe(res);
    } else if ((platform === 'facebook' || platform === 'instagram') && att.fileUrl) {
      const response = await axios.get(att.fileUrl, { responseType: 'stream' });
      res.setHeader('Content-Type', response.headers['content-type'] || att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline');
      if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
      response.data.pipe(res);
    } else if (platform === 'gmail' && att.attachmentId) {
      const gmail = await gmailService.getGmailClient(connectedAccountId);
      const gmailMsgId = message.platformMessageId;
      const attRes = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: gmailMsgId,
        id: att.attachmentId,
      });
      const buffer = Buffer.from(attRes.data.data, 'base64url');
      res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } else if (att.s3Key) {
      // Outbound attachments stored in S3 — redirect to pre-signed URL
      const url = await getPresignedUrl(att.s3Key);
      res.redirect(url);
    } else {
      return res.status(404).json({ error: 'No preview available' });
    }
  } catch (err) {
    console.error('Preview attachment error:', err);
    res.status(500).json({ error: 'Failed to preview attachment' });
  }
});

/**
 * Upload an outbound attachment to S3 and return the S3 key + metadata.
 */
async function persistOutboundAttachment(file) {
  const ext = file.originalname ? '.' + file.originalname.split('.').pop() : '';
  const s3Key = `outbound/${randomUUID()}${ext}`;
  await uploadFile(file.buffer, s3Key, file.mimetype);
  return s3Key;
}

// Send a message (with optional file attachments)
router.post('/send', authenticate, upload.array('attachments', 10), async (req, res) => {
  try {
    const { conversationId, content, subject: reqSubject } = req.body;
    const files = req.files || [];

    if (!conversationId || (!content && files.length === 0)) {
      return res.status(400).json({ error: 'conversationId and content (or attachments) are required' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        connectedAccount: { userId: req.user.id },
      },
      include: {
        connectedAccount: true,
        contact: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const { platform } = conversation.connectedAccount;
    let platformMessageId = null;
    let sentRawPayload    = null; // set by Gmail case; used when persisting the message
    const attachmentMeta = [];

    // Send via the correct platform API
    try {
      switch (platform) {
        case 'facebook': {
          const recipientPsid = await resolveMetaRecipientId(conversation, 'facebook');
          if (!recipientPsid) {
            return res.status(400).json({ error: 'No Facebook recipient found for this conversation' });
          }
          if (content) {
            const result = await facebookService.sendMessage(
              conversation.connectedAccountId,
              recipientPsid,
              content
            );
            platformMessageId = result.message_id;
          }
          for (const file of files) {
            const result = await facebookService.sendAttachment(
              conversation.connectedAccountId,
              recipientPsid,
              file
            );
            const meta = {
              filename: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              platformId: result.message_id || null,
            };
            // Persist image files to S3 for outbound preview
            if (file.mimetype.startsWith('image/') && file.buffer) {
              try { meta.s3Key = await persistOutboundAttachment(file); } catch { /* skip */ }
            }
            attachmentMeta.push(meta);
          }
          break;
        }
        case 'instagram': {
          const igRecipientId = await resolveMetaRecipientId(conversation, 'instagram');
          if (!igRecipientId) {
            return res.status(400).json({ error: 'No Instagram recipient found for this conversation' });
          }
          if (content) {
            const result = await instagramService.sendMessage(
              conversation.connectedAccountId,
              igRecipientId,
              content
            );
            platformMessageId = result.message_id;
          }
          for (const file of files) {
            const result = await instagramService.sendAttachment(
              conversation.connectedAccountId,
              igRecipientId,
              file
            );
            const meta = {
              filename: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              platformId: result.message_id || null,
            };
            // Persist image files to S3 for outbound preview
            if (file.mimetype.startsWith('image/') && file.buffer) {
              try { meta.s3Key = await persistOutboundAttachment(file); } catch { /* skip */ }
            }
            attachmentMeta.push(meta);
          }
          break;
        }
        case 'whatsapp': {
          if (content) {
            const result = await whatsappService.sendMessage(
              conversation.connectedAccountId,
              conversation.platformConversationId,
              content
            );
            platformMessageId = result.messages?.[0]?.id;
          }
          for (const file of files) {
            const result = await whatsappService.sendMedia(
              conversation.connectedAccountId,
              conversation.platformConversationId,
              file
            );
            attachmentMeta.push({
              filename: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              mediaId: result.mediaId || null,
              platformId: result.messages?.[0]?.id || null,
            });
          }
          break;
        }
        case 'gmail': {
          const recipientEmail = conversation.contact?.platformUserId;
          if (!recipientEmail) {
            return res.status(400).json({ error: 'No recipient email found for this Gmail conversation' });
          }

          // ── Fetch the last message for subject + threading headers ──────
          // We read from the DB so we don't need an extra live Gmail API call.
          // rawPayload contains the full Gmail message object including headers.
          const lastMsg = await prisma.message.findFirst({
            where: { conversationId: conversation.id },
            orderBy: { sentAt: 'desc' },
            select: { subject: true, content: true, sender: true, sentAt: true, rawPayload: true },
          });

          // ── Subject ──────────────────────────────────────────────────────
          let subject;
          if (reqSubject) {
            subject = reqSubject;
          } else {
            const baseSubject = lastMsg?.subject || '';
            subject = baseSubject
              ? (baseSubject.startsWith('Re:') ? baseSubject : `Re: ${baseSubject}`)
              : 'Re:';
          }

          // ── Threading headers from rawPayload ────────────────────────────
          // Extract Message-ID and References from the stored raw Gmail payload.
          // This is more reliable than a live API call and avoids the Neon cold-
          // start race that can strip these headers silently.
          let inReplyToMsgId = null;
          let references     = null;

          if (lastMsg?.rawPayload) {
            const rawHeaders = lastMsg.rawPayload?.payload?.headers || [];
            const getHdr = (name) =>
              rawHeaders.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || null;

            inReplyToMsgId = getHdr('Message-ID');
            const existingRefs = getHdr('References');

            if (inReplyToMsgId) {
              // Build the full References chain: previous chain + the parent's own ID
              references = [existingRefs, inReplyToMsgId].filter(Boolean).join(' ');
            }
          }

          // ── Quoted body ──────────────────────────────────────────────────
          // Append Gmail-style quoted reply so the recipient sees conversation
          // context. Only added when replying to an existing message.
          let bodyToSend = content || '';
          if (lastMsg?.content?.trim()) {
            const dateStr = lastMsg.sentAt
              ? new Date(lastMsg.sentAt).toLocaleString('en-US', {
                  weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit', hour12: true,
                })
              : '';
            const quotedLines = lastMsg.content.trim()
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n');
            bodyToSend =
              `${bodyToSend}\r\n\r\nOn ${dateStr}, ${lastMsg.sender || 'Unknown'} wrote:\r\n${quotedLines}`;
          }

          // ── Send ─────────────────────────────────────────────────────────
          const gmailResult = await gmailService.sendEmail(
            conversation.connectedAccountId,
            recipientEmail,
            subject,
            bodyToSend,
            conversation.platformConversationId,
            files,
            { inReplyToMsgId, references },
          );

          // ── Fetch RFC 2822 Message-ID from the sent message ──────────
          // messages.send returns the Gmail API id and threadId, but NOT the
          // email-level Message-ID header (e.g. <CA+xxx@mail.gmail.com>).
          // We need it so that future replies to THIS outbound message can set
          // a correct In-Reply-To without a live API call. Store it in rawPayload.
          try {
            const sentFull = await gmailService.getGmailClient(conversation.connectedAccountId)
              .then((g) => g.users.messages.get({
                userId: 'me',
                id: gmailResult.id,
                format: 'metadata',
                metadataHeaders: ['Message-ID', 'References', 'In-Reply-To'],
              }));
            sentRawPayload = sentFull.data;
          } catch (fetchErr) {
            console.warn('[Gmail API] Could not fetch sent message metadata:', fetchErr.message);
          }

          console.log('[Gmail API] Email sent successfully:', {
            to: recipientEmail,
            subject,
            messageId: gmailResult.id,
            threadId: gmailResult.threadId,
            inReplyTo: inReplyToMsgId || '(none — first message in thread)',
            rfc2822MessageId: sentRawPayload?.payload?.headers?.find(
              (h) => h.name.toLowerCase() === 'message-id'
            )?.value || '(not fetched)',
          });

          platformMessageId = gmailResult.id;

          for (const file of files) {
            const meta = {
              filename: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
            };
            // Persist image files to S3 for outbound preview
            if (file.mimetype.startsWith('image/') && file.buffer) {
              try { meta.s3Key = await persistOutboundAttachment(file); } catch { /* skip */ }
            }
            attachmentMeta.push(meta);
          }
          break;
        }
        default:
          return res.status(400).json({ error: `Unsupported platform: ${platform}` });
      }
    } catch (platformErr) {
      console.error(`[${platform}] Send error:`, platformErr);
      const status = platformErr?.response?.status || platformErr?.code || 500;
      const detail = platformErr?.response?.data?.error?.message
        || platformErr?.response?.data?.error
        || platformErr?.message
        || 'Unknown error';
      return res.status(typeof status === 'number' ? status : 502).json({
        error: `Failed to send via ${platform}: ${detail}`,
      });
    }
    // No file cleanup needed — memory storage buffers are garbage collected

    // Determine content type
    let contentType = platform === 'gmail' ? 'email' : 'text';
    if (files.length > 0 && !content) {
      const mime = files[0].mimetype;
      if (mime.startsWith('image/')) contentType = 'image';
      else if (mime.startsWith('video/')) contentType = 'video';
      else if (mime.startsWith('audio/')) contentType = 'audio';
      else contentType = 'file';
    }

    // For gmail, the subject was already resolved above — reuse it here.
    let savedSubject = null;
    if (platform === 'gmail') {
      // `subject` is already the resolved value from the Gmail case above
      savedSubject = typeof subject !== 'undefined' ? subject : null;
    }

    // Save message to DB
    // For Gmail outbound messages, store the metadata payload so that future
    // replies can read the RFC 2822 Message-ID without a live API call.
    const rawPayloadToStore = platform === 'gmail' && sentRawPayload ? sentRawPayload : undefined;

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        platformMessageId,
        direction: 'outbound',
        sender: req.user.name || req.user.email,
        subject: savedSubject,
        content: content || (attachmentMeta.length > 0 ? `[${attachmentMeta.map(a => a.filename).join(', ')}]` : ''),
        contentType,
        attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
        rawPayload: rawPayloadToStore,
        status: 'sent',
        sentAt: new Date(),
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // Emit socket event — mark as _fromSender so frontend dedup can recognize it
    const io = req.app.get('io');
    io.to(`user:${req.user.id}`).emit('new_message', {
      message,
      conversationId: conversation.id,
      _fromSender: true, // frontend already has this message via API response
    });

    io.to(`user:${req.user.id}`).emit('conversation_update', {
      conversationId: conversation.id,
      lastMessageAt: new Date(),
    });

    res.json({ message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
