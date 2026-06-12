// utils/socket.js
const { Server }            = require('socket.io');
const { verifyAccessToken } = require('./jwt.utils');

let _io = null;

module.exports = {

  init(server) {
    _io = new Server(server, {
      cors: {
        origin:      'http://localhost:4200',
        credentials: true
      }
    });

    // ── Auth middleware ──────────────────────────────────────────────
    _io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token;

        // Debug — remove once working
        console.log('[WS] handshake token (first 40):', token ? token.substring(0, 40) : 'MISSING');
        console.log('[WS] JWT_ACCESS_SECRET (first 6):', process.env.JWT_ACCESS_SECRET?.substring(0, 6) ?? 'UNDEFINED');

        if (!token) return next(new Error('Unauthorized'));

        const decoded = verifyAccessToken(token);

        console.log('[WS] decoded payload:', decoded);

        socket.userId = decoded.sub;

        if (!socket.userId) {
          console.error('[WS] sub missing from payload');
          return next(new Error('Invalid token payload'));
        }

        next();
      } catch (err) {
        // Catch ALL errors including synchronous ones from verifyAccessToken
        console.error('[WS] middleware error:', err.message);
        next(new Error('Invalid token'));
      }
    });

    // ── Connection handler ───────────────────────────────────────────
    _io.on('connection', (socket) => {
      try {
        socket.join(`user:${socket.userId}`);
        console.log(`[WS] User ${socket.userId} connected — rooms:`, [...socket.rooms]);
      } catch (err) {
        console.error('[WS] connection handler error:', err.message);
      }

      socket.on('disconnect', () => {
        console.log(`[WS] User ${socket.userId} disconnected`);
      });

      socket.on('error', (err) => {
        console.error('[WS] socket error:', err.message);
      });
    });

    // ── Catch engine-level errors so they don't become UnhandledRejection ──
    _io.engine.on('connection_error', (err) => {
      console.error('[WS] engine connection_error:', err.code, err.message, err.context);
    });

    return _io;
  },

  getIO() {
    if (!_io) throw new Error('Socket.io not initialized');
    return _io;
  }

};