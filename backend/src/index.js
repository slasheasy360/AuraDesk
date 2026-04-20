import 'dotenv/config';
import { execSync } from 'child_process';
import express from 'express';

// Run pending migrations before the server starts.
// Handles P3009 (stuck failed migration) and P3018 (migration fails because
// the schema object already exists) by marking them as applied and retrying.
// Loops up to 20 times so a chain of already-applied migrations all resolve.
try {
  const MAX_RETRIES = 20;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = execSync('npx prisma migrate deploy', { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
      if (out) process.stdout.write(out);
      break; // success — exit loop
    } catch (deployErr) {
      const stdout = (deployErr.stdout || '').toString();
      const stderr = (deployErr.stderr || '').toString();
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      const combined = stdout + stderr;

      // P3009: previous run left a migration in a failed state
      // "The `<name>` migration started at ... failed"
      const p3009 = [...combined.matchAll(/`([^`]+)` migration started at .+? failed/gs)];

      // P3018: migration fails because object already exists in DB (42710 / 42P07)
      // "Migration name: <name>" paired with an already-exists DB error
      const alreadyExists = /already exists|42710|42P07/i.test(combined);
      const p3018 = alreadyExists
        ? [...combined.matchAll(/Migration name: ([^\n\r]+)/g)]
        : [];

      const toResolve = [...p3009, ...p3018];
      if (toResolve.length === 0 || attempt === MAX_RETRIES) throw deployErr;

      for (const m of toResolve) {
        const name = m[1].trim();
        console.log(`[Startup] Marking migration as applied: ${name}`);
        execSync(`npx prisma migrate resolve --applied "${name}"`, { stdio: 'inherit' });
      }
      // loop continues → retries migrate deploy
    }
  }
} catch (err) {
  console.error('[Startup] prisma migrate deploy failed:', err.message);
  process.exit(1);
}
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
import profileRoutes from './routes/profile.js';
import teamRoutes from './routes/team.js';
import planRoutes from './routes/plan.js';
import aiRoutes from './routes/ai.js';
import aiTrainingRoutes from './routes/ai-training.js';
import contactRoutes from './routes/contacts.js';
import metaWebhook from './webhooks/meta.js';
import gmailWebhook from './webhooks/gmail.js';
import { renewExpiringWatches, reRegisterAllWatches } from './services/gmail.js';
import prisma from './utils/prisma.js';
import { authenticate, requireActiveSubscription } from './middleware/auth.js';

// Routes that handle paid product features. Gating them at mount-time means
// every endpoint inside automatically inherits the subscription check.
// Routes that must stay accessible WITHOUT a paid subscription:
//   - /auth/*               (login, register, forgot password)
//   - /api/profile          (user must always be able to update their profile)
//   - /api/subscription     (user must always be able to manage billing)
//   - /api/onboarding       (must run during the trial / onboarding window)
//   - /api/team             (workspace owner manages team independently)
const requirePaidAccess = [authenticate, requireActiveSubscription];
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

  socket.on('register', async (userId) => {
    if (!userId) return;
    // Team members join the workspace owner's room so they receive the same
    // real-time events (new messages, conversation updates) as the owner.
    // Owners join their own room (inviterUserId is null for them).
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { inviterUserId: true },
    });
    const roomId = user?.inviterUserId || userId;
    socket.join(`user:${roomId}`);
    const roomSize = io.sockets.adapter.rooms.get(`user:${roomId}`)?.size || 0;
    console.log(`[Socket.io] User ${userId} joined room user:${roomId} on socket ${socket.id} (${roomSize} socket(s) in room)`);
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
const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};
app.use(cors(corsOptions));
// Explicitly handle pre-flight OPTIONS for all routes (required for multipart uploads)
app.options('*', cors(corsOptions));
app.use(express.json());

// Auth routes (no /api prefix — OAuth redirects)
app.use('/auth', authRoutes);
app.use('/auth/gmail', gmailRoutes);
app.use('/auth/facebook', facebookRoutes);
app.use('/auth/instagram', instagramRoutes);
app.use('/auth/whatsapp', whatsappRoutes);

// API routes — gated routes require an active paid plan / live trial
app.use('/api/conversations', requirePaidAccess, conversationRoutes);
app.use('/api/messages',      requirePaidAccess, messageRoutes);
app.use('/api/accounts',      requirePaidAccess, accountRoutes);
app.use('/api/contacts',      requirePaidAccess, contactRoutes);
app.use('/api/leads',         requirePaidAccess, leadRoutes);
// Invoices: NOT mounted with the gate because /api/invoices/public/:slug
// must stay reachable for unauthenticated invoice viewers. The gate is
// applied per-handler inside the route file via requireActiveSubscription.
app.use('/api/invoices',      invoiceRoutes);

// Open routes — accessible regardless of subscription status
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/onboarding',   onboardingRoutes);
app.use('/api/profile',      profileRoutes);
app.use('/api/team',         teamRoutes);
// Plan usage + limits — always accessible so the UI can render counters
// and upgrade prompts regardless of subscription status.
app.use('/api/plan',         planRoutes);
// AI reply generation — gated by requireActiveSubscription inside the
// route itself so we can return a proper plan-limit JSON on quota hits.
app.use('/api/ai',           aiRoutes);
app.use('/api/ai-training',  authenticate, aiTrainingRoutes);

// Alias: GET /api/user/onboarding-status
// Mirrors /api/onboarding/status. Kept as a thin alias because some clients
// expect the user-namespaced path. Returns the same canonical shape:
//   { onboardingCompleted, hasOrganization, platformsConnected, ... }
app.get('/api/user/onboarding-status', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      onboardingStep: true,
      onboardingCompleted: true,
      companyName: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const platformCount = await prisma.connectedAccount.count({
    where: { userId: req.user.id, status: 'active' },
  });
  res.json({
    onboardingCompleted: user.onboardingCompleted,
    hasOrganization: !!user.companyName,
    platformsConnected: platformCount > 0,
    platformCount,
    onboardingStep: user.onboardingStep,
  });
});

// Webhook routes
app.use('/webhooks/meta', metaWebhook);
app.use('/webhooks/gmail', gmailWebhook);

// ── Global error handler ─────────────────────────────────────────────────────
// Catches any error passed via next(err) or thrown inside async route handlers
// that are wrapped with an error-forwarding try/catch. Returns a structured
// JSON error instead of Express's default HTML 500 page, and logs the full
// stack + request context so failures are easy to diagnose.
app.use((err, req, res, _next) => {
  const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
  console.error('[UnhandledError]', {
    method: req.method,
    url: req.originalUrl,
    status,
    orgId: req.user?.id ?? null,
    message: err.message,
    stack: err.stack,
  });
  if (res.headersSent) return;
  res.status(status).json({
    error: status >= 500
      ? 'Something went wrong. Please try again.'
      : (err.message || 'Request failed'),
  });
});

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

  // Keep Neon free tier awake — ping DB every 4 minutes to prevent cold starts
  setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch { /* silent — next real query will reconnect */ }
  }, 4 * 60 * 1000);
});
