import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import * as gmailService from '../services/gmail.js';
import * as gmailSyncService from '../services/gmail.service.js';
import prisma from '../utils/prisma.js';
import { getOrCreateStripeCustomer } from '../utils/stripe.js';
import { assertCanConnectPlatform } from '../services/planGuard.js';

const router = Router();

// Extract a single usable frontend URL from FRONTEND_URL (may be comma-separated)
function getFrontendUrl() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:5173';
  const urls = raw.split(',').map((u) => u.trim()).filter(Boolean);
  return (urls.length > 1 ? urls[urls.length - 1] : urls[0]).replace(/\/$/, '');
}

// GET /auth/gmail — Google OAuth login (no auth required)
// Redirects to Google consent screen for login (email + profile only)
router.get('/', (req, res) => {
  const state = Buffer.from(JSON.stringify({ mode: 'login' })).toString('base64url');
  const url = gmailService.getAuthUrl(state);
  res.redirect(url);
});

// GET /auth/gmail/start — Gmail channel connection — admin/owner only
router.get('/start', authenticate, requireAdmin, async (req, res) => {
  // Phase 1: log-only plan guard (never blocks).
  try { await assertCanConnectPlatform(req.user, 'gmail', { context: 'gmail/start' }); } catch (_) {}
  const popup = String(req.query.popup || '') === '1';
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, mode: 'connect', popup })).toString('base64url');
  const url = gmailService.getAuthUrl(state);
  res.json({ url });
});

// GET /auth/gmail/connect — Gmail channel connection via browser redirect — admin/owner only
router.get('/connect', async (req, res) => {
  const { token } = req.query;
  const popup = String(req.query.popup || '') === '1';
  if (!token) {
    return res.redirect(`${getFrontendUrl()}/login?error=auth_required`);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Enforce admin-only: look up the user's role before allowing the OAuth flow
    const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { role: true } });
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
      return res.redirect(`${getFrontendUrl()}/connections?error=forbidden`);
    }
    const state = Buffer.from(JSON.stringify({ userId: decoded.userId, mode: 'connect', popup })).toString('base64url');
    const url = gmailService.getAuthUrl(state);
    res.redirect(url);
  } catch {
    res.redirect(`${getFrontendUrl()}/login?error=invalid_token`);
  }
});

// GET /auth/gmail/callback — handles BOTH login and channel connection
router.get('/callback', async (req, res) => {
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
  let mode = 'login';
  let connectUserId = null;
  let popup = false;

  const resolveConnectTarget = async () => {
    if (!connectUserId) return `${frontendUrl}/connections`;
    try {
      const u = await prisma.user.findUnique({ where: { id: connectUserId }, select: { onboardingStep: true } });
      return u && u.onboardingStep < 4 ? `${frontendUrl}/onboarding` : `${frontendUrl}/connections`;
    } catch {
      return `${frontendUrl}/connections`;
    }
  };

  const redirectWithError = async (errorCode) => {
    const target = mode === 'connect' ? await resolveConnectTarget() : `${frontendUrl}/login`;
    return res.redirect(`${target}?error=${encodeURIComponent(errorCode)}`);
  };

  try {
    const { code, state } = req.query;
    if (!code || !state) {
      // Google sends state back even on cancel. Parse it so we know whether
      // the user was in login vs connect mode and can redirect correctly.
      if (state) {
        try {
          const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
          mode = parsed.mode || 'login';
          connectUserId = parsed.userId || null;
          popup = Boolean(parsed.popup);
          if (popup) {
            return sendPopupResponse({
              type: 'auradesk:connect',
              platform: 'gmail',
              status: 'error',
              reason: 'cancelled',
            });
          }
          // Connect-mode cancel: resolve onboarding vs connections target and
          // use the platform-named ?error= param so OnboardingPage can display it.
          if (mode === 'connect') {
            const target = await resolveConnectTarget();
            return res.redirect(`${target}?error=gmail&reason=cancelled`);
          }
        } catch { }
      }
      return redirectWithError('cancelled');
    }

    const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    mode = stateData.mode || 'login';
    popup = Boolean(stateData.popup);

    if (stateData.mode === 'login') {
      // === LOGIN FLOW ===
      // Exchange code for tokens using the same OAuth2 client (same redirect_uri)
      const client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Get Google profile
      const oauth2 = google.oauth2({ version: 'v2', auth: client });
      const { data: profile } = await oauth2.userinfo.get();

      if (!profile.email) {
        return redirectWithError('no_email');
      }

      // Find or create user
      let user = await prisma.user.findUnique({ where: { email: profile.email } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: profile.email,
            name: profile.name || profile.email,
            passwordHash: await bcrypt.hash(crypto.randomUUID(), 12),
          },
        });
      }

      // Provision Stripe customer eagerly (non-fatal). Without this, Google-login
      // users never get a customer created at signup and rely entirely on the
      // lazy fallback in create-checkout — which fails if a stale ID exists.
      try {
        await getOrCreateStripeCustomer(user);
      } catch (e) {
        console.warn(`[auth/google] Stripe customer creation deferred for ${user.email}: ${e.message}`);
      }

      // Decide where to send the user after login — same logic as email login in
      // LoginPage.jsx so Google users aren't bypassing the pricing page.
      const hasActivePlan =
        (['starter', 'pro', 'elite'].includes(user.plan)) ||
        (user.plan === 'trial' && user.trialEndsAt && new Date() < new Date(user.trialEndsAt));
      const next = !hasActivePlan
        ? '/pricing'
        : !user.onboardingCompleted
          ? '/onboarding'
          : '/inbox';

      // Issue JWT and redirect to frontend dashboard
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.redirect(`${frontendUrl}/dashboard?token=${token}&next=${encodeURIComponent(next)}`);
    } else {
      // === CHANNEL CONNECTION FLOW ===
      const { userId } = stateData;
      connectUserId = userId;
      if (!userId) {
        return redirectWithError('missing_user_id');
      }
      const connectedAccount = await gmailService.handleCallback(code, userId);

      // Initial sync — pull recent emails
      try {
        await gmailSyncService.syncGmailMessages(userId);
      } catch (syncErr) {
        console.error('Initial Gmail sync after connect failed:', syncErr);
      }

      // Start Gmail Pub/Sub watch for real-time notifications
      try {
        await gmailService.startWatch(connectedAccount.id);
      } catch (watchErr) {
        console.error('Gmail watch start failed (Pub/Sub may not be configured):', watchErr.message);
      }

      // Redirect to onboarding if user hasn't completed it, otherwise connections page
      if (popup) {
        return sendPopupResponse({
          type: 'auradesk:connect',
          platform: 'gmail',
          status: 'success',
        });
      }

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingStep: true } });
      const redirectPath = (user && user.onboardingStep < 4) ? '/onboarding' : '/connections';
      res.redirect(`${frontendUrl}${redirectPath}?success=gmail`);
    }
  } catch (err) {
    console.error('Gmail callback error:', err);
    if (err.code === 'DUPLICATE_ACCOUNT') {
      const target = await resolveConnectTarget();
      if (popup) {
        return sendPopupResponse({
          type: 'auradesk:connect',
          platform: 'gmail',
          status: 'error',
          reason: err.message,
        });
      }
      return res.redirect(`${target}?error=gmail&reason=${encodeURIComponent(err.message)}`);
    }
    if (popup) {
      return sendPopupResponse({
        type: 'auradesk:connect',
        platform: 'gmail',
        status: 'error',
        reason: 'google_auth_failed',
      });
    }
    await redirectWithError('google_auth_failed');
  }
});

export default router;
