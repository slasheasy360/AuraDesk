import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import * as facebookService from '../services/facebook.js';
import * as instagramService from '../services/instagram.js';
import * as whatsappService from '../services/whatsapp.js';
import * as gmailService from '../services/gmail.js';
import { syncGmailMessagesController, gmailDiagnosticController } from '../controllers/gmail.controller.js';
import { syncInstagramMessages } from '../services/instagram.sync.js';

const router = Router();

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

// Send a message
router.post('/send', authenticate, async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    if (!conversationId || !content) {
      return res.status(400).json({ error: 'conversationId and content are required' });
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

    // Send via the correct platform API
    try {
      switch (platform) {
        case 'facebook': {
          const result = await facebookService.sendMessage(
            conversation.connectedAccountId,
            conversation.platformConversationId,
            content
          );
          platformMessageId = result.message_id;
          break;
        }
        case 'instagram': {
          // Use contact's platformUserId (Instagram-scoped user ID) for sending,
          // since platformConversationId may be the IG conversation ID from sync
          const igRecipientId = conversation.contact?.platformUserId || conversation.platformConversationId;
          const result = await instagramService.sendMessage(
            conversation.connectedAccountId,
            igRecipientId,
            content
          );
          platformMessageId = result.message_id;
          break;
        }
        case 'whatsapp': {
          const result = await whatsappService.sendMessage(
            conversation.connectedAccountId,
            conversation.platformConversationId,
            content
          );
          platformMessageId = result.messages?.[0]?.id;
          break;
        }
        case 'gmail': {
          const recipientEmail = conversation.contact?.platformUserId;
          if (!recipientEmail) {
            return res.status(400).json({ error: 'No recipient email found for this Gmail conversation' });
          }

          const lastMsg = await prisma.message.findFirst({
            where: { conversationId: conversation.id },
            orderBy: { sentAt: 'desc' },
            select: { subject: true },
          });
          const subject = lastMsg?.subject
            ? (lastMsg.subject.startsWith('Re:') ? lastMsg.subject : `Re: ${lastMsg.subject}`)
            : 'Re:';

          const result = await gmailService.sendEmail(
            conversation.connectedAccountId,
            recipientEmail,
            subject,
            content,
            conversation.platformConversationId
          );
          platformMessageId = result.id;
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

    // Save message to DB
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        platformMessageId,
        direction: 'outbound',
        sender: req.user.name || req.user.email,
        content,
        contentType: platform === 'gmail' ? 'email' : 'text',
        status: 'sent',
        sentAt: new Date(),
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // Emit socket event
    const io = req.app.get('io');
    io.to(`user:${req.user.id}`).emit('new_message', {
      message,
      conversationId: conversation.id,
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
