import { Router } from 'express';
import { authenticate, getWorkspaceOwnerId } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';

const router = Router();

// PATCH /api/contacts/:id — rename a contact (name field only)
// All workspace members can rename contacts (needed for the reply workflow)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Scope the update to the workspace owner's contacts
    const ownerId = getWorkspaceOwnerId(req.user);
    const existing = await prisma.contact.findFirst({
      where: { id, userId: ownerId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const updated = await prisma.contact.update({
      where: { id },
      data: { name: trimmed },
    });

    res.json({ contact: updated });
  } catch (err) {
    console.error('Update contact error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

export default router;
