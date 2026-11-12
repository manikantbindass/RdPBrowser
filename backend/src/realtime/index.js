'use strict';
const { Server } = require('socket.io');
const { authenticateToken } = require('../middleware/auth');
const { withTenant,uuid } = require('../db/tenant');
const { query,transaction } = require('../db/db');
function authorize(socket, config, token,resource='realtime.connect') {
  return new Promise((resolve, reject) => {
    const req = { accessResource:resource,headers: { authorization: `Bearer ${token || ''}` }, app: { locals: { config } } };
    const res = { status() { return this; }, json() { reject(new Error('Socket authentication failed')); } };
    authenticateToken(req, res, err => err ? reject(err) : resolve(req.user));
  });
}
function attachRealtime({ server, config, logger }) {
  const io = new Server(server, { cors: { origin: config.origins },maxHttpBufferSize:16384,
    allowRequest:require('./sourceGate').createSourceGate(config) });
  // Recheck live authorization before every sensitive outbound notification.
  // Room membership alone is not a revocation boundary.
  io.emitToAdmins=async (organizationId,event,payload) => {
    for (const socket of await io.in(`admin:${organizationId}`).fetchSockets()) {
      try {
        const user=await authorize(socket,config,socket.handshake.auth?.token,'admin.manage');
        if (user.organizationId!==organizationId || !['admin','superadmin'].includes(user.role)) throw new Error('Revoked');
        socket.emit(event,payload);
      } catch { socket.disconnect(true); }
    }
  };
  const activeSessions = new Map();
  io.use((socket, next) => authorize(socket, config, socket.handshake.auth?.token).then(user => {
    socket.data.user = user; next();
  }, () => next(new Error('Socket authentication failed'))));
  io.on('connection', (socket) => {
    logger.info({ event: 'realtime.connected', socketId: socket.id });

    socket.on('join_admin', async (token) => {
      // Verify admin JWT before allowing dashboard events
      try {
        const payload = await authorize(socket, config, token,'admin.manage');
        if (!['admin', 'superadmin'].includes(payload.role)) throw new Error('Not admin');
        if (payload.sub!==socket.data.user.sub || payload.organizationId!==socket.data.user.organizationId) throw new Error('Identity changed');
        socket.data.isAdmin = true;
        socket.join(`admin:${payload.organizationId}`);
        socket.emit('sessions_snapshot', Array.from(activeSessions.values()).filter(s => s.organizationId===payload.organizationId));
      } catch {
        socket.disconnect(true);
      }
    });

    socket.on('force_logout', async (userId) => {
      try {
        const now=Date.now();
        if (!socket.data.window || now-socket.data.window>60000) { socket.data.window=now; socket.data.operations=0; }
        if (++socket.data.operations>10 || !uuid.test(userId || '')) throw new Error('Invalid operation');
        const user = await authorize(socket, config, socket.handshake.auth?.token,'admin.manage');
        if (!socket.data.isAdmin || !['admin', 'superadmin'].includes(user.role)) throw new Error('Not admin');
        await withTenant(user.organizationId,() => transaction(async () => {
          const target=await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
          if (!target.rows.length) throw new Error('Target not found');
          await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1',[userId]);
          await query("INSERT INTO audit_log(actor_id,action,target) VALUES($1,'force_logout',$2)",[user.sub,userId]);
        }));
        await io.emitToAdmins(user.organizationId,'user_forced_out',userId);
      } catch { socket.disconnect(true); return; }
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
