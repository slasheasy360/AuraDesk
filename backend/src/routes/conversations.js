import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';

const router = Router();

// Get all conversations for current user
router.get('/', authenticate, async (req, res) => {
  try {
    const { platform } = req.query;

    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: req.user.id, status: 'active' },
      select: { id: true },
    });

    const accountIds = accounts.map((a) => a.id);

    const where = { connectedAccountId: { in: accountIds } };
    if (platform) where.connectedAccount = { platform };

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        contact: {
          select: { id: true, name: true, username: true, avatarUrl: true, platform: true },
        },
        connectedAccount: {
          select: { id: true, platform: true, displayName: true },
        },
        messages: {
          take: 1,
          orderBy: { sentAt: 'desc' },
          select: { content: true, contentType: true, direction: true, sentAt: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    res.json({ conversations });
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get single conversation
router.get('/:id', authenticate, async (req, res) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        connectedAccount: { userId: req.user.id },
      },
      include: {
        contact: true,
        connectedAccount: {
          select: { id: true, platform: true, displayName: true },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Mark as read
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: 0 },
    });

    res.json({ conversation });
  } catch (err) {
    console.error('Get conversation error:', err);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

export default router;
