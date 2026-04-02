import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('[Startup] Created uploads directory');
}

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
import metaWebhook from './webhooks/meta.js';
import gmailWebhook from './webhooks/gmail.js';
import { renewExpiringWatches, reRegisterAllWatches } from './services/gmail.js';

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

// Webhook routes
app.use('/webhooks/meta', metaWebhook);
app.use('/webhooks/gmail', gmailWebhook);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

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
