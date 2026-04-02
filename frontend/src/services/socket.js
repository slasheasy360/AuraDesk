import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let socket = null;
let currentUserId = null;
let keepAliveTimer = null;

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
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,        // reconnect fast after disconnect
    reconnectionDelayMax: 3000,
    withCredentials: true,
  });

  socket.on('connect', () => {
    console.log(`[Socket] Connected: id=${socket.id}, transport=${socket.io.engine.transport.name}`);
    socket.emit('register', currentUserId);

    // ── Keep-alive: send a tiny message every 30s to prevent Render from
    // killing the connection due to inactivity. This is separate from
    // Socket.io's ping/pong (which Render's proxy may not recognize).
    clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      if (socket?.connected) {
        socket.emit('ping_keep_alive');
      }
    }, 30000);
  });

  socket.on('connect_error', (err) => {
    console.error(`[Socket] Connection error: ${err.message}`, err.description || '');
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: reason=${reason}`);
    clearInterval(keepAliveTimer);
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
