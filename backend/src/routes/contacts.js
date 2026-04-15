import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';

const router = Router();

// PATCH /api/contacts/:id — rename a contact (name field only)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Scope the update to the current user's contacts only
    const existing = await prisma.contact.findFirst({
      where: { id, userId: req.user.id },
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
