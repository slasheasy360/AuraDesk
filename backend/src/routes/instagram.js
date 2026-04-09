import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth.js';
import * as instagramService from '../services/instagram.js';
import { syncInstagramMessages } from '../services/instagram.sync.js';
import prisma from '../utils/prisma.js';
import { assertCanConnectPlatform } from '../services/planGuard.js';

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
router.get('/start', authenticate, async (req, res) => {
  // Phase 1: log-only plan guard (never blocks).
  try { await assertCanConnectPlatform(req.user, 'instagram', { context: 'instagram/start' }); } catch (_) {}
  const popup = String(req.query.popup || '') === '1';
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, popup })).toString('base64url');
  const url = instagramService.getLoginUrl(state);
  res.json({ url });
});

// Instagram OAuth callback
router.get('/callback', async (req, res) => {
  let userId = null;
  let popup = false;
  const frontendUrl = getFrontendUrl();
  const sendPopupResponse = (payload) => {
    const json = JSON.stringify(payload);
    const html = `<!doctype html><html><head><meta charset="utf-8"/></head><body>
      <script>
        try {
          if (window.opener) {
            window.opener.postMessage(${json}, "${frontendUrl}");
          }
        } catch (e) {}
        window.close();
      </script>
    </body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  };
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      if (state) {
        try {
          const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
          if (parsed.popup) {
            return sendPopupResponse({
              type: 'auradesk:connect',
              platform: 'instagram',
              status: 'error',
              reason: 'cancelled',
            });
          }
          // Non-popup cancel — route back to the correct page so the user
          // isn't stranded on a blank 400. Check onboardingStep so onboarding
          // users land back on the wizard, not the connections page.
          if (parsed.userId) {
            const u = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { onboardingStep: true } });
            const target = (u && u.onboardingStep < 4) ? '/onboarding' : '/connections';
            return res.redirect(`${frontendUrl}${target}?error=instagram&reason=cancelled`);
          }
        } catch { }
      }
      return res.redirect(`${frontendUrl}/connections?error=instagram&reason=cancelled`);
    }

    ({ userId, popup } = JSON.parse(Buffer.from(state, 'base64url').toString()));
    await instagramService.handleCallback(code, userId);

    // Initial sync — pull existing Instagram DM conversations
    try {
      await syncInstagramMessages(userId);
    } catch (syncErr) {
      console.error('Initial Instagram sync after connect failed:', syncErr.message);
    }

    // Redirect to onboarding if user hasn't completed it, otherwise connections page
    if (popup) {
      return sendPopupResponse({
        type: 'auradesk:connect',
        platform: 'instagram',
        status: 'success',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingStep: true } });
    const redirectPath = (user && user.onboardingStep < 4) ? '/onboarding' : '/connections';
    res.redirect(`${frontendUrl}${redirectPath}?success=instagram`);
  } catch (err) {
    console.error('Instagram callback error:', err);
    const reason = err.code === 'DUPLICATE_ACCOUNT' ? err.message : 'Connection failed. Please try again.';
    let target = '/connections';
    if (userId) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingStep: true } });
        if (user && user.onboardingStep < 4) target = '/onboarding';
      } catch { }
    }
    if (popup) {
      return sendPopupResponse({
        type: 'auradesk:connect',
        platform: 'instagram',
        status: 'error',
        reason,
      });
    }
    res.redirect(`${frontendUrl}${target}?error=instagram&reason=${encodeURIComponent(reason)}`);
  }
});

export default router;
