import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let socket = null;
let currentUserId = null;

export function connectSocket(userId) {
  // If already connected for the same user, don't recreate
  if (socket && currentUserId === userId) {
    if (!socket.connected) socket.connect();
    return socket;
  }

  // Different user — tear down old socket first
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  currentUserId = userId;

  socket = io(SOCKET_URL, {
    // Start with polling (works through all proxies), then upgrade to websocket.
    // This is more reliable on Render than starting with websocket directly,
    // because the initial handshake via polling always succeeds.
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    // Keep connection alive — Render kills idle connections after ~60-120s
    withCredentials: true,
  });

  socket.on('connect', () => {
    console.log(`[Socket] Connected: id=${socket.id}, transport=${socket.io.engine.transport.name}, url=${SOCKET_URL}`);
    // Re-register on every connect (including reconnects)
    socket.emit('register', currentUserId);
  });

  socket.on('connect_error', (err) => {
    console.error(`[Socket] Connection error: ${err.message}`, err.description || '');
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: reason=${reason}`);
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    currentUserId = null;
  }
}
