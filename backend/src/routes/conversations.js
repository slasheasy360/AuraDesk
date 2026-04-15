import { Router } from 'express';
import { authenticate, getWorkspaceOwnerId } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import { emitToUser } from '../utils/socket.js';

const router = Router();

// ─── Helper: get all active accounts for the workspace owner ───
async function getWorkspaceAccounts(ownerId) {
  return prisma.connectedAccount.findMany({
    where: { userId: ownerId, status: 'active' },
    select: { id: true, createdAt: true },
  });
}

async function getWorkspaceAccountIds(ownerId) {
  const accounts = await getWorkspaceAccounts(ownerId);
  return accounts.map((a) => a.id);
}

// ─── Helper: verify conversation belongs to workspace ───
async function findWorkspaceConversation(conversationId, ownerId) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      connectedAccount: { userId: ownerId },
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const accounts = await getWorkspaceAccounts(ownerId);

    // Only show conversations with activity AFTER the account was connected.
    // This hides historical messages that were synced from before connection.
    let eligibleAccounts = accounts;
    if (platform) {
      const platformAccountIds = await prisma.connectedAccount.findMany({
        where: { id: { in: accounts.map((a) => a.id) }, platform },
        select: { id: true },
      });
      const pidSet = new Set(platformAccountIds.map((a) => a.id));
      eligibleAccounts = accounts.filter((a) => pidSet.has(a.id));
    }

    // Build per-account filter: conversation must have lastMessageAt >= account.createdAt.
    // Allow 60s before createdAt to handle clock skew between Meta's servers and ours —
    // a message whose sentAt is 30s before our server recorded createdAt can legitimately
    // belong to this account window.
    const GRACE_MS = 60 * 1000;
    const accountFilter = eligibleAccounts.map((acc) => ({
      connectedAccountId: acc.id,
      lastMessageAt: { gte: new Date(new Date(acc.createdAt).getTime() - GRACE_MS) },
    }));

    if (accountFilter.length === 0) {
      return res.json({ conversations: [] });
    }

    const where = { OR: accountFilter };

    // Apply category filters on top
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

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        contact: {
          select: { id: true, name: true, username: true, avatarUrl: true, platform: true },
        },
        connectedAccount: {
          // Include createdAt so we can filter pre-connection messages below
          select: { id: true, platform: true, displayName: true, createdAt: true },
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

    // Secondary filter: verify the latest message's actual sentAt falls within the
    // account window (with the same 60s grace period used in the DB query above).
    const postConnectionConversations = conversations.filter((c) => {
      const connectedAt = c.connectedAccount?.createdAt;
      const latestMsgSentAt = c.messages?.[0]?.sentAt;
      if (!connectedAt || !latestMsgSentAt) return false;
      return new Date(latestMsgSentAt) >= new Date(new Date(connectedAt).getTime() - GRACE_MS);
    });

    // Add hasDraft flag for frontend convenience
    const enriched = postConnectionConversations.map((c) => ({
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const accountIds = await getWorkspaceAccountIds(ownerId);
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await findWorkspaceConversation(req.params.id, ownerId);
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await findWorkspaceConversation(req.params.id, ownerId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isStarred: !conversation.isStarred },
    });

    emitToUser(ownerId, 'conversation_state_change', {
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, connectedAccount: { userId: ownerId } },
      include: {
        contact: true,
        connectedAccount: { select: { platform: true } },
        messages: { take: 1, orderBy: { sentAt: 'desc' }, select: { sentAt: true } },
      },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Single source of truth: Lead table. Toggle = create-if-missing or delete-if-present.
    const existingLead = await prisma.lead.findUnique({
      where: { conversationId: conversation.id },
    });

    if (existingLead) {
      // ── Unmark: delete Lead, sync flag ──
      await prisma.lead.delete({ where: { id: existingLead.id } });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { isLead: false },
      });
      emitToUser(ownerId, 'lead_deleted', { id: existingLead.id });
      emitToUser(ownerId, 'conversation_state_change', {
        conversationId: conversation.id,
        field: 'isLead',
        value: false,
      });
      return res.json({ conversationId: conversation.id, isLead: false, lead: null });
    }

    // ── Mark as lead: create Lead row from conversation data ──
    const platformMap = {
      instagram: 'Instagram',
      whatsapp: 'WhatsApp',
      gmail: 'Gmail',
      facebook: 'Facebook',
    };
    const name = conversation.contact?.name || conversation.contact?.username || 'Unknown';
    const platform = platformMap[conversation.connectedAccount?.platform] || 'Other';
    const lastContactedAt =
      conversation.lastMessageAt || conversation.messages?.[0]?.sentAt || new Date();

    const lead = await prisma.lead.create({
      data: {
        userId: ownerId,
        name,
        platform,
        lastContactedAt,
        lastAction: 'New Lead',
        status: 'New',
        conversationId: conversation.id,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isLead: true },
    });

    emitToUser(ownerId, 'lead_created', { lead });
    emitToUser(ownerId, 'conversation_state_change', {
      conversationId: conversation.id,
      field: 'isLead',
      value: true,
    });

    res.json({ conversationId: conversation.id, isLead: true, lead });
  } catch (err) {
    // Handle race / unique-constraint clash gracefully
    if (err?.code === 'P2002') {
      return res.status(200).json({ conversationId: req.params.id, isLead: true, alreadyExists: true });
    }
    console.error('Toggle lead error:', err);
    res.status(500).json({ error: 'Failed to toggle lead' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/conversations/:id/delete — Soft delete (move to bin)
// ═══════════════════════════════════════════════════════════════════

router.patch('/:id/delete', authenticate, async (req, res) => {
  try {
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await findWorkspaceConversation(req.params.id, ownerId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    emitToUser(ownerId, 'conversation_state_change', {
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await findWorkspaceConversation(req.params.id, ownerId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isDeleted: false, deletedAt: null },
    });

    emitToUser(ownerId, 'conversation_state_change', {
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await findWorkspaceConversation(req.params.id, ownerId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation.isDeleted) {
      return res.status(400).json({ error: 'Conversation must be in bin before permanent deletion' });
    }

    await prisma.conversation.delete({ where: { id: conversation.id } });

    emitToUser(ownerId, 'conversation_removed', {
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await findWorkspaceConversation(req.params.id, ownerId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const { content, subject } = req.body;

    // If content is empty, delete the draft
    if (!content || !content.trim()) {
      await prisma.draft.deleteMany({ where: { conversationId: conversation.id } });
      emitToUser(ownerId, 'draft_update', {
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

    emitToUser(ownerId, 'draft_update', {
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await findWorkspaceConversation(req.params.id, ownerId);
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
    const ownerId = getWorkspaceOwnerId(req.user);
    const conversation = await findWorkspaceConversation(req.params.id, ownerId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await prisma.draft.deleteMany({ where: { conversationId: conversation.id } });

    emitToUser(ownerId, 'draft_update', {
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
