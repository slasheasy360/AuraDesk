import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';

const router = Router();

// Get all connected accounts for the current user
router.get('/', authenticate, async (req, res) => {
  try {
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        platform: true,
        platformAccountId: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ accounts });
  } catch (err) {
    console.error('Get accounts error:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Disconnect an account
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { status: 'disconnected' },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

export default router;
