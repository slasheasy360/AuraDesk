import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as facebookService from '../services/facebook.js';
import { syncFacebookMessages } from '../services/facebook.sync.js';
import prisma from '../utils/prisma.js';

const router = Router();
const DEFAULT_FRONTEND_URL = 'https://aura-desk.vercel.app';

function getFrontendUrl() {
  const raw = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
  const urls = raw.split(',').map((u) => u.trim()).filter(Boolean);
  return (urls.length > 1 ? urls[urls.length - 1] : urls[0]).replace(/\/$/, '');
}

// Backward-compatible shortcut for old clients that still call /auth/facebook.
router.get('/', authenticate, (req, res) => {
  const state = facebookService.encodeConnectState(req.user.id);
  const url = facebookService.getLoginUrl(state);
  res.redirect(url);
});

// Start Facebook OAuth for page connection (authenticated)
router.get('/start', authenticate, async (req, res) => {
  try {
    const state = facebookService.encodeConnectState(req.user.id);
    const url = facebookService.getLoginUrl(state);
    console.log('[Facebook OAuth] /start — generated OAuth URL', {
      userId: req.user.id,
      redirectUri: process.env.FACEBOOK_REDIRECT_URI,
    });
    res.json({ url });
  } catch (err) {
    console.error('[Facebook OAuth] /start — failed:', err.message);
    res.status(500).json({ error: 'Failed to initialize Facebook OAuth' });
  }
});

// Facebook OAuth callback — Facebook redirects here after user approves
router.get('/callback', async (req, res) => {
  const frontendUrl = getFrontendUrl();
  console.log('[Facebook OAuth] /callback — received', {
    hasCode: Boolean(req.query.code),
    hasState: Boolean(req.query.state),
    error: req.query.error || null,
    errorReason: req.query.error_reason || null,
    errorDescription: req.query.error_description || null,
  });

  // Handle user denial
  if (req.query.error) {
    console.warn('[Facebook OAuth] User denied or error from Facebook:', req.query.error_description);
    return res.redirect(`${frontendUrl}/connections?error=facebook&reason=${encodeURIComponent(req.query.error_description || req.query.error)}`);
  }

  try {
    const { code, state } = req.query;
    if (!code || typeof code !== 'string') {
      console.warn('[Facebook OAuth] Missing or invalid code query param');
      return res.redirect(`${frontendUrl}/connections?error=facebook&reason=missing_code`);
    }

    if (!state || typeof state !== 'string') {
      console.warn('[Facebook OAuth] Missing or invalid state query param');
      return res.redirect(`${frontendUrl}/connections?error=facebook&reason=missing_state`);
    }

    const { userId } = facebookService.decodeConnectState(state);
    if (!userId) {
      console.warn('[Facebook OAuth] Decoded state without userId');
      return res.redirect(`${frontendUrl}/connections?error=facebook&reason=invalid_state`);
    }

    console.log('[Facebook OAuth] /callback — decoded state', { userId });

    // Exchange code → token → fetch pages → subscribe webhooks → save
    const tokenResponse = await facebookService.exchangeCodeForAccessToken(code);

    if (!tokenResponse.access_token) {
      console.error('[Facebook OAuth] Token exchange returned no access_token', tokenResponse);
      return res.redirect(`${frontendUrl}/connections?error=facebook&reason=no_token`);
    }

    const result = await facebookService.handleCallbackWithToken(tokenResponse.access_token, userId);

    console.log('[Facebook OAuth] /callback — SUCCESS', {
      fbAccountId: result.connectedAccount.id,
      pagesCount: result.pages.length,
      hasInstagram: Boolean(result.igAccount),
    });

    // Initial sync — pull existing Messenger conversations
    try {
      await syncFacebookMessages(userId);
    } catch (syncErr) {
      console.error('Initial Facebook sync after connect failed:', syncErr.message);
    }

    // Redirect to onboarding if user hasn't completed it, otherwise connections page
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingStep: true } });
    const redirectPath = (user && user.onboardingStep < 4) ? '/onboarding' : '/connections';
    return res.redirect(`${frontendUrl}${redirectPath}?success=facebook`);
  } catch (err) {
    const fbError = err.response?.data?.error;
    console.error('[Facebook OAuth] /callback — FAILED', {
      message: err.message,
      fbCode: fbError?.code,
      fbType: fbError?.type,
      fbSubcode: fbError?.error_subcode,
      fbMessage: fbError?.message,
      fbTraceId: fbError?.fbtrace_id,
      rawData: err.response?.data || null,
      stack: err.stack,
    });
    return res.redirect(`${frontendUrl}/connections?error=facebook&reason=${encodeURIComponent(err.message)}`);
  }
});

export default router;
