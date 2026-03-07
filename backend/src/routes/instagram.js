import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as instagramService from '../services/instagram.js';

const router = Router();

// Start Instagram OAuth (goes through Facebook Login)
router.get('/start', authenticate, (req, res) => {
  const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64url');
  const url = instagramService.getLoginUrl(state);
  res.json({ url });
});

// Instagram OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    const { userId } = JSON.parse(Buffer.from(state, 'base64url').toString());
    await instagramService.handleCallback(code, userId);

    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/connections?success=instagram`);
  } catch (err) {
    console.error('Instagram callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/connections?error=instagram`);
  }
});

export default router;
