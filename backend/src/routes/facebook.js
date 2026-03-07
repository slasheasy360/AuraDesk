import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as facebookService from '../services/facebook.js';

const router = Router();

// Start Facebook OAuth
router.get('/start', authenticate, (req, res) => {
  const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64url');
  const url = facebookService.getLoginUrl(state);
  res.json({ url });
});

// Facebook OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    const { userId } = JSON.parse(Buffer.from(state, 'base64url').toString());
    await facebookService.handleCallback(code, userId);

    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/connections?success=facebook`);
  } catch (err) {
    console.error('Facebook callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/connections?error=facebook`);
  }
});

export default router;
