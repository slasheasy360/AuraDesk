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
    console.log('[Facebook OAuth] Generated start URL', {
      userId: req.user.id,
      redirectUri: process.env.FACEBOOK_REDIRECT_URI,
    });
    res.json({ url });
  } catch (err) {
    console.error('[Facebook OAuth] Failed to start OAuth:', err.message);
    res.status(500).json({ error: 'Failed to initialize Facebook OAuth' });
  }
});

// Facebook OAuth callback
router.get('/callback', async (req, res) => {
  const frontendUrl = getFrontendUrl();
  try {
    const { code, state } = req.query;
    if (!code || typeof code !== 'string') {
      console.warn('[Facebook OAuth] Missing or invalid code query param', { codeType: typeof code });
      return res.redirect(`${frontendUrl}?error=facebook_auth_failed`);
    }

    if (!state || typeof state !== 'string') {
      console.warn('[Facebook OAuth] Missing or invalid state query param', { stateType: typeof state });
      return res.redirect(`${frontendUrl}?error=facebook_auth_failed`);
    }

    const { userId } = facebookService.decodeConnectState(state);
    if (!userId) {
      console.warn('[Facebook OAuth] Decoded state without userId');
      return res.redirect(`${frontendUrl}?error=facebook_auth_failed`);
    }

    const tokenResponse = await facebookService.exchangeCodeForAccessToken(code);
    console.log('[Facebook OAuth] Token exchange response', {
      hasAccessToken: Boolean(tokenResponse.access_token),
      tokenType: tokenResponse.token_type || null,
      expiresIn: tokenResponse.expires_in || null,
    });

    await facebookService.handleCallbackWithToken(tokenResponse.access_token, userId);
    return res.redirect(`${frontendUrl}/connections?success=facebook`);
  } catch (err) {
    const facebookError = err.response?.data?.error;
    console.error('[Facebook OAuth] Callback failed', {
      message: err.message,
      code: facebookError?.code,
      type: facebookError?.type,
      subcode: facebookError?.error_subcode,
      traceId: facebookError?.fbtrace_id,
      raw: err.response?.data || null,
    });
    return res.redirect(`${frontendUrl}?error=facebook_auth_failed`);
  }
});

export default router;
