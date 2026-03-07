import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as gmailService from '../services/gmail.js';

const router = Router();

// Start Gmail OAuth
router.get('/start', authenticate, (req, res) => {
  const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64url');
  const url = gmailService.getAuthUrl(state);
  res.json({ url });
});

// Gmail OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    const { userId } = JSON.parse(Buffer.from(state, 'base64url').toString());
    await gmailService.handleCallback(code, userId);

    // Redirect to frontend connection success page
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/connections?success=gmail`);
  } catch (err) {
    console.error('Gmail callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/connections?error=gmail`);
  }
});

export default router;
