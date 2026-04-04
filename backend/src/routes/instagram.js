import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth.js';
import * as instagramService from '../services/instagram.js';
import { syncInstagramMessages } from '../services/instagram.sync.js';
import prisma from '../utils/prisma.js';

const router = Router();

// Extract a single usable frontend URL from FRONTEND_URL (may be comma-separated)
function getFrontendUrl() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:5173';
  const urls = raw.split(',').map((u) => u.trim()).filter(Boolean);
  // Prefer the last entry (production URL) if multiple are set
  return (urls.length > 1 ? urls[urls.length - 1] : urls[0]).replace(/\/$/, '');
}

// Direct browser redirect to Instagram OAuth (requires token in query param)
router.get('/', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.redirect(`${getFrontendUrl()}/login?error=auth_required`);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const state = Buffer.from(JSON.stringify({ userId: decoded.userId })).toString('base64url');
    const url = instagramService.getLoginUrl(state);
    res.redirect(url);
  } catch {
    res.redirect(`${getFrontendUrl()}/login?error=invalid_token`);
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

    // Initial sync — pull existing Instagram DM conversations
    try {
      await syncInstagramMessages(userId);
    } catch (syncErr) {
      console.error('Initial Instagram sync after connect failed:', syncErr.message);
    }

    // Redirect to onboarding if user hasn't completed it, otherwise connections page
    const frontendUrl = getFrontendUrl();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingStep: true } });
    const redirectPath = (user && user.onboardingStep < 4) ? '/onboarding' : '/connections';
    res.redirect(`${frontendUrl}${redirectPath}?success=instagram`);
  } catch (err) {
    console.error('Instagram callback error:', err);
    const reason = err.code === 'DUPLICATE_ACCOUNT' ? err.message : 'Connection failed. Please try again.';
    res.redirect(`${getFrontendUrl()}/connections?error=instagram&reason=${encodeURIComponent(reason)}`);
  }
});

export default router;
