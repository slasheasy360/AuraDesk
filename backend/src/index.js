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
import metaWebhook from './webhooks/meta.js';
import gmailWebhook from './webhooks/gmail.js';
import { renewExpiringWatches } from './services/gmail.js';

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// Store io on app for access in routes
app.set('io', io);

// User socket tracking
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('register', (userId) => {
    socket.join(`user:${userId}`);
    console.log(`User ${userId} registered on socket ${socket.id}`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Raw body for webhook signature validation — must be before express.json()
app.use('/webhooks', express.raw({ type: 'application/json' }));

// Standard middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
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

// Webhook routes
app.use('/webhooks/meta', metaWebhook);
app.use('/webhooks/gmail', gmailWebhook);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`AuraDesk backend running on port ${PORT}`);

  // Renew expiring Gmail watches every 6 hours
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    renewExpiringWatches().catch((err) => {
      console.error('[Cron] Gmail watch renewal failed:', err.message);
    });
  }, SIX_HOURS);

  // Also run once on startup (after a short delay to let DB connect)
  setTimeout(() => {
    renewExpiringWatches().catch((err) => {
      console.error('[Startup] Gmail watch renewal failed:', err.message);
    });
  }, 10000);
});
