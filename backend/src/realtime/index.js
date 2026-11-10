'use strict';
const { Server } = require('socket.io');
const { authenticateToken } = require('../middleware/auth');
function authorize(socket, config, token) {
  return new Promise((resolve, reject) => {
    const req = { headers: { authorization: `Bearer ${token || ''}` }, app: { locals: { config } } };
    const res = { status() { return this; }, json() { reject(new Error('Socket authentication failed')); } };
    authenticateToken(req, res, err => err ? reject(err) : resolve(req.user));
  });
}
function attachRealtime({ server, config, logger }) {
  const io = new Server(server, { cors: { origin: config.origins } });
  const activeSessions = new Map();
  io.use((socket, next) => authorize(socket, config, socket.handshake.auth?.token).then(user => {
    socket.data.user = user; next();
  }, () => next(new Error('Socket authentication failed'))));
  io.on('connection', (socket) => {
    logger.info({ event: 'realtime.connected', socketId: socket.id });

    socket.on('join_admin', async (token) => {
      // Verify admin JWT before allowing dashboard events
      try {
        const payload = await authorize(socket, config, token);
        if (!['admin', 'superadmin'].includes(payload.role)) throw new Error('Not admin');
        socket.data.isAdmin = true;
        socket.join('admin_room');
        socket.emit('sessions_snapshot', Array.from(activeSessions.values()));
      } catch {
        socket.disconnect(true);
      }
    });

    socket.on('force_logout', async (userId) => {
      try {
        const user = await authorize(socket, config, socket.handshake.auth?.token);
        if (!socket.data.isAdmin || !['admin', 'superadmin'].includes(user.role)) throw new Error('Not admin');
      } catch { socket.disconnect(true); return; }
      io.to('admin_room').emit('user_forced_out', userId);
      activeSessions.delete(userId);
    });

    socket.on('disconnect', () => {
      logger.info({ event: 'realtime.disconnected', socketId: socket.id });
    });

    if (config.SSH_ENABLED) require('./ssh').attachExperimentalSsh(socket, logger);
  });
  return { io, activeSessions };
}
module.exports = { attachRealtime, authorize };
