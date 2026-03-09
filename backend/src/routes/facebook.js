import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import * as facebookService from '../services/facebook.js';
import prisma from '../utils/prisma.js';

const router = Router();
const GRAPH_API = 'https://graph.facebook.com/v21.0';

// Facebook OAuth login — redirect to Facebook consent screen
router.get('/', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${process.env.NGROK_URL || 'http://localhost:3001'}/auth/facebook/callback`,
    scope: 'email,public_profile',
    response_type: 'code',
    state: 'facebook_login',
  });
  res.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params}`);
});

// Start Facebook OAuth for page connection (authenticated)
router.get('/start', authenticate, (req, res) => {
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, mode: 'connect' })).toString('base64url');
  const url = facebookService.getLoginUrl(state);
  res.json({ url });
});

// Facebook OAuth callback — handles both login and page connection
router.get('/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).send('Missing authorization code');
    }

    // Check if this is a login flow or a page connection flow
    if (state === 'facebook_login') {
      // LOGIN FLOW: Get user profile, find/create user, issue JWT
      const tokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: `${process.env.NGROK_URL || 'http://localhost:3001'}/auth/facebook/callback`,
          code,
        },
      });

      const accessToken = tokenRes.data.access_token;

      // Get user profile
      const profileRes = await axios.get(`${GRAPH_API}/me`, {
        params: { fields: 'id,name,email,picture', access_token: accessToken },
      });

      const profile = profileRes.data;
      if (!profile.email) {
        return res.redirect(`${frontendUrl}/login?error=no_email`);
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

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.redirect(`${frontendUrl}/dashboard?token=${token}`);
    } else {
      // PAGE CONNECTION FLOW (existing behavior)
      if (!state) return res.status(400).send('Missing state');
      const { userId } = JSON.parse(Buffer.from(state, 'base64url').toString());
      await facebookService.handleCallback(code, userId);
      res.redirect(`${frontendUrl}/connections?success=facebook`);
    }
  } catch (err) {
    console.error('Facebook callback error:', err);
    res.redirect(`${frontendUrl}/login?error=facebook_auth_failed`);
  }
});

export default router;
