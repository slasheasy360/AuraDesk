import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import * as gmailService from '../services/gmail.js';
import * as gmailSyncService from '../services/gmail.service.js';
import prisma from '../utils/prisma.js';

const router = Router();

// GET /auth/gmail — Google OAuth login (no auth required)
// Redirects to Google consent screen for login (email + profile only)
router.get('/', (req, res) => {
  const state = Buffer.from(JSON.stringify({ mode: 'login' })).toString('base64url');
  const url = gmailService.getAuthUrl(state);
  res.redirect(url);
});

// GET /auth/gmail/start — Gmail channel connection (authenticated, returns JSON)
router.get('/start', authenticate, (req, res) => {
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, mode: 'connect' })).toString('base64url');
  const url = gmailService.getAuthUrl(state);
  res.json({ url });
});

// GET /auth/gmail/connect — Gmail channel connection via browser redirect
router.get('/connect', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=auth_required`);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const state = Buffer.from(JSON.stringify({ userId: decoded.userId, mode: 'connect' })).toString('base64url');
    const url = gmailService.getAuthUrl(state);
    res.redirect(url);
  } catch {
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=invalid_token`);
  }
});

// GET /auth/gmail/callback — handles BOTH login and channel connection
router.get('/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  let mode = 'login';

  const redirectWithError = (errorCode) => {
    const target = mode === 'connect' ? `${frontendUrl}/connections` : `${frontendUrl}/login`;
    return res.redirect(`${target}?error=${encodeURIComponent(errorCode)}`);
  };

  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return redirectWithError('missing_code_or_state');
    }

    const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    mode = stateData.mode || 'login';

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

      // Issue JWT and redirect to frontend dashboard
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.redirect(`${frontendUrl}/dashboard?token=${token}`);
    } else {
      // === CHANNEL CONNECTION FLOW ===
      const { userId } = stateData;
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

      res.redirect(`${frontendUrl}/connections?success=gmail`);
    }
  } catch (err) {
    console.error('Gmail callback error:', err);
    redirectWithError('google_auth_failed');
  }
});

export default router;
