import prisma from './prisma.js';

/**
 * Auto-create a Lead for a new inbound conversation if one doesn't already exist.
 * Called from webhook handlers after a new inbound message is saved.
 * Idempotent — silently skips if the lead already exists (P2002 unique constraint).
 */
export async function autoCreateLead({ conversationId, userId, name, platform, email, lastContactedAt, io }) {
  try {
    const existing = await prisma.lead.findUnique({ where: { conversationId } });
    if (existing) return;

    const lead = await prisma.lead.create({
      data: {
        userId,
        name: name || 'Unknown',
        platform,
        email: email || null,
        lastContactedAt: lastContactedAt || new Date(),
        lastAction: 'New Lead',
        status: 'New',
        conversationId,
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { isLead: true },
    });

    if (io) {
      io.to(`user:${userId}`).emit('lead_created', { lead });
    }
  } catch (err) {
    if (err?.code === 'P2002') return; // Race condition — another request beat us, ignore
    console.error('[AutoLead] Failed to create lead:', err?.message);
  }
}
