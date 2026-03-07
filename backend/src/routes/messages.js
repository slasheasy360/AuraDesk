import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import * as facebookService from '../services/facebook.js';
import * as instagramService from '../services/instagram.js';
import * as whatsappService from '../services/whatsapp.js';
import * as gmailService from '../services/gmail.js';

const router = Router();

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
        const result = await instagramService.sendMessage(
          conversation.connectedAccountId,
          conversation.platformConversationId,
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
        const result = await gmailService.sendEmail(
          conversation.connectedAccountId,
          conversation.platformConversationId, // For Gmail, this is the email address or thread ID
          'Re: Conversation', // Subject
          content,
          conversation.platformConversationId
        );
        platformMessageId = result.id;
        break;
      }
    }

    // Save message to DB
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        platformMessageId,
        direction: 'outbound',
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
