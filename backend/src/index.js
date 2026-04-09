import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';

import authRoutes from './routes/auth.js';
import gmailRoutes from './routes/gmail.js';
import facebookRoutes from './routes/facebook.js';
import instagramRoutes from './routes/instagram.js';
import whatsappRoutes from './routes/whatsapp.js';
import conversationRoutes from './routes/conversations.js';
import messageRoutes from './routes/messages.js';
import accountRoutes from './routes/accounts.js';
import subscriptionRoutes from './routes/subscription.js';
import onboardingRoutes from './routes/onboarding.js';
import leadRoutes from './routes/leads.js';
import invoiceRoutes from './routes/invoices.js';
import metaWebhook from './webhooks/meta.js';
import gmailWebhook from './webhooks/gmail.js';
import { renewExpiringWatches, reRegisterAllWatches } from './services/gmail.js';
import prisma from './utils/prisma.js';
import { sendEmail } from './utils/email.js';
import { sendWelcomeEmail } from './emails/senders/sendWelcomeEmail.js';

const app = express();
const server = http.createServer(app);

// ── CORS origin list ────────────────────────────────────────────────────────
// Build an array of allowed origins from FRONTEND_URL (comma-separated) so
// both local dev and production frontends can connect to Socket.io and the API.
// Example: FRONTEND_URL=http://localhost:5173,https://auradesk.vercel.app
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

console.log(`[Startup] Allowed CORS origins: ${allowedOrigins.join(', ')}`);

// Socket.io setup
// Render free tier: proxy can kill idle connections and may not support
// WebSocket upgrade reliably. Allow both transports, use aggressive pings.
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Allow both — client starts with polling, upgrades to websocket if possible
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  pingInterval: 15000,   // ping every 15s — must be under Render's idle timeout
  pingTimeout: 10000,    // wait 10s for pong
  connectTimeout: 10000,
  // Increase buffer size for messages queued during transport switch
  maxHttpBufferSize: 1e6,
});

// Store io on app for access in routes
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`[Socket.io] Connected: ${socket.id}, transport=${socket.conn.transport.name}`);

  socket.on('register', (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
    const roomSize = io.sockets.adapter.rooms.get(`user:${userId}`)?.size || 0;
    console.log(`[Socket.io] User ${userId} joined room on socket ${socket.id} (${roomSize} socket(s) in room)`);
  });

  // Client sends this every 30s to keep Render's proxy from killing the connection
  socket.on('ping_keep_alive', () => {
    // No-op — the act of receiving any message resets Render's idle timer
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket.io] Disconnected: ${socket.id}, reason=${reason}`);
  });
});

// Raw body for webhook signature validation — must be before express.json()
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use('/api/subscription/webhook', express.raw({ type: 'application/json' }));

// Standard middleware
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Auth routes (no /api prefix — OAuth redirects)
app.use('/auth', authRoutes);
app.use('/auth/gmail', gmailRoutes);
app.use('/auth/facebook', facebookRoutes);
app.use('/auth/instagram', instagramRoutes);
app.use('/auth/whatsapp', whatsappRoutes);

// API routes
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/invoices', invoiceRoutes);

// Webhook routes
app.use('/webhooks/meta', metaWebhook);
app.use('/webhooks/gmail', gmailWebhook);

// Health check with DB connectivity
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      db: 'ok',
      version: 'custom-domain-1',
      deployedFrom: 'kundan_dev-custom-domain',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'error', timestamp: new Date().toISOString() });
  }
});

// TEMPORARY: SES integration test endpoint. Remove after verification.
// Protected by a shared secret to prevent abuse.
app.post('/dev/test-email', async (req, res) => {
  if (req.headers['x-test-secret'] !== process.env.JWT_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const result = await sendEmail({
      to: req.body?.to || process.env.SES_FROM_EMAIL,
      subject: 'AuraDesk SES Test Email',
      html: '<h1>Hello from AuraDesk</h1><p>If you can read this, AWS SES integration is working.</p><p>Sent at: ' + new Date().toISOString() + '</p>',
    });
    res.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error('[/dev/test-email] failed:', err);
    res.status(500).json({ ok: false, error: err.message, name: err.name });
  }
});

// TEMPORARY: Welcome template test endpoint. Remove after verification.
// POST /dev/test-welcome { to, firstName? }
app.post('/dev/test-welcome', async (req, res) => {
  if (req.headers['x-test-secret'] !== process.env.JWT_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const to = req.body?.to;
    if (!to) return res.status(400).json({ error: 'body.to is required' });
    const result = await sendWelcomeEmail({
      email: to,
      firstName: req.body?.firstName,
      name: req.body?.name,
    });
    res.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error('[/dev/test-welcome] failed:', err);
    res.status(500).json({ ok: false, error: err.message, name: err.name });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`AuraDesk backend running on port ${PORT}`);

  // Log WhatsApp env var status on startup
  const waToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN;
  if (waToken) {
    console.log(`[Startup] WHATSAPP_SYSTEM_USER_TOKEN: length=${waToken.length}, starts="${waToken.substring(0, 10)}...", ends="...${waToken.substring(waToken.length - 10)}"`);
  } else {
    console.warn('[Startup] WHATSAPP_SYSTEM_USER_TOKEN is not set');
  }

  // Renew expiring Gmail watches every 6 hours
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    renewExpiringWatches().catch((err) => {
      console.error('[Cron] Gmail watch renewal failed:', err.message);
    });
  }, SIX_HOURS);

  // Re-register ALL Gmail watches on startup to ensure label config is current
  // (e.g. after deploying changes to watched labels like adding SENT)
  setTimeout(() => {
    reRegisterAllWatches().catch((err) => {
      console.error('[Startup] Gmail watch re-registration failed:', err.message);
    });
  }, 10000);
});
