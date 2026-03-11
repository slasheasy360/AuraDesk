import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth.js';
import * as instagramService from '../services/instagram.js';

const router = Router();

// Direct browser redirect to Instagram OAuth (requires token in query param)
router.get('/', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=auth_required`);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const state = Buffer.from(JSON.stringify({ userId: decoded.userId })).toString('base64url');
    const url = instagramService.getLoginUrl(state);
    res.redirect(url);
  } catch {
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=invalid_token`);
  }
});

// Start Instagram OAuth (authenticated API call)
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
