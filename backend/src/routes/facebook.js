import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as facebookService from '../services/facebook.js';

const router = Router();
const DEFAULT_FRONTEND_URL = 'https://aura-desk.vercel.app';

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).replace(/\/$/, '');
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

    console.log('[Facebook OAuth] /callback — SUCCESS, redirecting to connections', {
      fbAccountId: result.connectedAccount.id,
      pagesCount: result.pages.length,
      hasInstagram: Boolean(result.igAccount),
    });

    return res.redirect(`${frontendUrl}/connections?success=facebook`);
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
