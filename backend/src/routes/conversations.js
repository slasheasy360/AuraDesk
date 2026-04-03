import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import { emitToUser } from '../utils/socket.js';

const router = Router();

// ─── Helper: get all active account IDs for user ───
async function getUserAccountIds(userId) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, status: 'active' },
    select: { id: true },
  });
  return accounts.map((a) => a.id);
}

// ─── Helper: verify conversation belongs to user ───
async function findUserConversation(conversationId, userId) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      connectedAccount: { userId },
    },
    include: {
      contact: true,
      connectedAccount: { select: { id: true, platform: true, displayName: true } },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/conversations — List conversations with filter support
// ═══════════════════════════════════════════════════════════════════

router.get('/', authenticate, async (req, res) => {
  try {
    const { platform, filter } = req.query;
    const accountIds = await getUserAccountIds(req.user.id);

    const where = { connectedAccountId: { in: accountIds } };

    // By default, exclude deleted conversations unless requesting bin
    if (filter === 'bin') {
      where.isDeleted = true;
    } else if (filter === 'starred') {
      where.isDeleted = false;
      where.isStarred = true;
    } else if (filter === 'leads') {
      where.isDeleted = false;
      where.isLead = true;
    } else {
      where.isDeleted = false;
    }

    if (platform) {
      where.connectedAccount = { ...where.connectedAccount, platform };
    }

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
        drafts: {
          select: { id: true, content: true, updatedAt: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    // Add hasDraft flag for frontend convenience
    const enriched = conversations.map((c) => ({
      ...c,
      hasDraft: c.drafts && c.drafts.length > 0,
      draftPreview: c.drafts?.[0]?.content?.slice(0, 80) || null,
    }));

    res.json({ conversations: enriched });
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/conversations/counts — Filter counts for sidebar
// ═══════════════════════════════════════════════════════════════════

router.get('/counts', authenticate, async (req, res) => {
  try {
    const accountIds = await getUserAccountIds(req.user.id);
    const baseWhere = { connectedAccountId: { in: accountIds } };

    const [all, unread, starred, leads, bin, drafts] = await Promise.all([
      prisma.conversation.count({ where: { ...baseWhere, isDeleted: false } }),
      prisma.conversation.count({ where: { ...baseWhere, isDeleted: false, unreadCount: { gt: 0 } } }),
      prisma.conversation.count({ where: { ...baseWhere, isDeleted: false, isStarred: true } }),
      prisma.conversation.count({ where: { ...baseWhere, isDeleted: false, isLead: true } }),
      prisma.conversation.count({ where: { ...baseWhere, isDeleted: true } }),
      prisma.draft.count({
        where: { conversation: { connectedAccountId: { in: accountIds }, isDeleted: false } },
      }),
    ]);

    res.json({ counts: { all, unread, starred, leads, bin, drafts } });
  } catch (err) {
    console.error('Get counts error:', err);
    res.status(500).json({ error: 'Failed to fetch counts' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/conversations/:id — Single conversation
// ═══════════════════════════════════════════════════════════════════

router.get('/:id', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Mark as read
    if (conversation.unreadCount > 0) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { unreadCount: 0 },
      });
    }

    // Include draft if any
    const draft = await prisma.draft.findUnique({
      where: { conversationId: conversation.id },
    });

    res.json({ conversation: { ...conversation, draft } });
  } catch (err) {
    console.error('Get conversation error:', err);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/conversations/:id/star — Toggle star
// ═══════════════════════════════════════════════════════════════════

router.patch('/:id/star', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isStarred: !conversation.isStarred },
    });

    emitToUser(req.user.id, 'conversation_state_change', {
      conversationId: conversation.id,
      field: 'isStarred',
      value: updated.isStarred,
    });

    res.json({ conversationId: conversation.id, isStarred: updated.isStarred });
  } catch (err) {
    console.error('Toggle star error:', err);
    res.status(500).json({ error: 'Failed to toggle star' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/conversations/:id/lead — Toggle lead
// ═══════════════════════════════════════════════════════════════════

router.patch('/:id/lead', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isLead: !conversation.isLead },
    });

    emitToUser(req.user.id, 'conversation_state_change', {
      conversationId: conversation.id,
      field: 'isLead',
      value: updated.isLead,
    });

    res.json({ conversationId: conversation.id, isLead: updated.isLead });
  } catch (err) {
    console.error('Toggle lead error:', err);
    res.status(500).json({ error: 'Failed to toggle lead' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/conversations/:id/delete — Soft delete (move to bin)
// ═══════════════════════════════════════════════════════════════════

router.patch('/:id/delete', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    emitToUser(req.user.id, 'conversation_state_change', {
      conversationId: conversation.id,
      field: 'isDeleted',
      value: true,
    });

    res.json({ conversationId: conversation.id, isDeleted: true });
  } catch (err) {
    console.error('Delete conversation error:', err);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/conversations/:id/restore — Restore from bin
// ═══════════════════════════════════════════════════════════════════

router.patch('/:id/restore', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isDeleted: false, deletedAt: null },
    });

    emitToUser(req.user.id, 'conversation_state_change', {
      conversationId: conversation.id,
      field: 'isDeleted',
      value: false,
    });

    res.json({ conversationId: conversation.id, isDeleted: false });
  } catch (err) {
    console.error('Restore conversation error:', err);
    res.status(500).json({ error: 'Failed to restore conversation' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/conversations/:id/permanent — Permanent delete
// ═══════════════════════════════════════════════════════════════════

router.delete('/:id/permanent', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation.isDeleted) {
      return res.status(400).json({ error: 'Conversation must be in bin before permanent deletion' });
    }

    await prisma.conversation.delete({ where: { id: conversation.id } });

    emitToUser(req.user.id, 'conversation_removed', {
      conversationId: conversation.id,
    });

    res.json({ deleted: true });
  } catch (err) {
    console.error('Permanent delete error:', err);
    res.status(500).json({ error: 'Failed to permanently delete conversation' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/conversations/:id/draft — Save or update draft
// ═══════════════════════════════════════════════════════════════════

router.put('/:id/draft', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const { content, subject } = req.body;

    // If content is empty, delete the draft
    if (!content || !content.trim()) {
      await prisma.draft.deleteMany({ where: { conversationId: conversation.id } });
      emitToUser(req.user.id, 'draft_update', {
        conversationId: conversation.id,
        draft: null,
      });
      return res.json({ draft: null });
    }

    const draft = await prisma.draft.upsert({
      where: { conversationId: conversation.id },
      create: {
        conversationId: conversation.id,
        content: content.trim(),
        subject: subject || null,
      },
      update: {
        content: content.trim(),
        subject: subject || null,
      },
    });

    emitToUser(req.user.id, 'draft_update', {
      conversationId: conversation.id,
      draft,
    });

    res.json({ draft });
  } catch (err) {
    console.error('Save draft error:', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/conversations/:id/draft — Get draft for conversation
// ═══════════════════════════════════════════════════════════════════

router.get('/:id/draft', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const draft = await prisma.draft.findUnique({
      where: { conversationId: conversation.id },
    });

    res.json({ draft: draft || null });
  } catch (err) {
    console.error('Get draft error:', err);
    res.status(500).json({ error: 'Failed to fetch draft' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/conversations/:id/draft — Delete draft
// ═══════════════════════════════════════════════════════════════════

router.delete('/:id/draft', authenticate, async (req, res) => {
  try {
    const conversation = await findUserConversation(req.params.id, req.user.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await prisma.draft.deleteMany({ where: { conversationId: conversation.id } });

    emitToUser(req.user.id, 'draft_update', {
      conversationId: conversation.id,
      draft: null,
    });

    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete draft error:', err);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

export default router;
