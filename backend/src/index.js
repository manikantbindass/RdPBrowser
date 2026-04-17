'use strict';

require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { Client: SSHClient } = require('ssh2');
const winston = require('winston');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const proxyRoutes = require('./routes/proxy');
const { vpnCheck } = require('./middleware/vpnCheck');
const { authenticateToken } = require('./middleware/auth');
const { initDB } = require('./db/db');

// Optional anomaly detector — loaded at runtime if enabled
let startAnomalyDetector = null;
try {
  startAnomalyDetector = require('../../../security/anomaly-detector/detector').startAnomalyDetector;
} catch (_) {
  // Not available in test environments or standalone backend deployments
}

// ─── Logger ──────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: process.env.LOG_FILE || 'logs/app.log' }),
  ],
});

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── Socket.io ───────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: process.env.DASHBOARD_ORIGIN || 'http://localhost:4000' },
});

// Make io accessible to routes
app.set('io', io);
app.set('logger', logger);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

app.use(cors({
  origin: (origin, cb) => {
    // Only allow requests from VPN subnet or admin dashboard
    const allowed = [
      process.env.DASHBOARD_ORIGIN || 'http://localhost:4000',
    ];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('CORS: Origin not allowed'));
  },
  credentials: true,
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ─── Health Check (no VPN check, used by load balancers) ─────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'RemoteShield X Backend' });
});

// ─── VPN Enforcement ─────────────────────────────────────────────────────────
// ALL routes below this line require traffic to come from VPN subnet
app.use('/api', vpnCheck);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);
app.use('/api/proxy', authenticateToken, proxyRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error({ message: err.message, stack: err.stack });
  const status = err.status || 500;
  res.status(status).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ─── Socket.io Events ────────────────────────────────────────────────────────
const activeSessions = new Map();

io.on('connection', (socket) => {
  logger.info(`Admin dashboard connected: ${socket.id}`);

  socket.on('join_admin', (token) => {
    // Verify admin JWT before allowing dashboard events
    try {
      const jwt = require('jsonwebtoken');
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.role !== 'admin') throw new Error('Not admin');
      socket.join('admin_room');
      socket.emit('sessions_snapshot', Array.from(activeSessions.values()));
    } catch {
      socket.disconnect(true);
    }
  });

  socket.on('force_logout', (userId) => {
    io.to('admin_room').emit('user_forced_out', userId);
    activeSessions.delete(userId);
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });

  // ─── Web SSH Proxy ───
  let sshClient = null;
  let sshStream = null;

  socket.on('ssh_connect', (creds) => {
    logger.info(`SSH connect requested for ${creds.host} by ${socket.id}`);
    sshClient = new SSHClient();
    
    sshClient.on('ready', () => {
      socket.emit('ssh_status', 'SSH Connection ready. Starting shell...');
      sshClient.shell((err, stream) => {
        if (err) {
          socket.emit('ssh_status', `Shell error: ${err.message}`);
          return;
        }
        sshStream = stream;
        socket.emit('ssh_status', 'Connected successfully.\r\n');
        
        stream.on('data', (d) => socket.emit('ssh_data', d.toString('utf-8')));
        stream.on('close', () => {
          socket.emit('ssh_status', '\r\nConnection closed.');
          sshClient.end();
        });
      });
    }).on('error', (err) => {
      socket.emit('ssh_status', `SSH Error: ${err.message}`);
    }).connect({
      host: creds.host,
      port: creds.port || 22,
      username: creds.username,
      password: creds.password || undefined // In production, fetch safely or use keys
    });
  });

  socket.on('ssh_data', (data) => {
    if (sshStream) sshStream.write(data);
  });

  socket.on('ssh_resize', ({ rows, cols }) => {
    if (sshStream) sshStream.setWindow(rows, cols, 0, 0);
  });

  socket.on('disconnect', () => {
    if (sshClient) sshClient.end();
  });
});


// Expose session map to routes
app.set('activeSessions', activeSessions);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    await initDB();
    logger.info('✅ Database connected and schema initialized');

    if (process.env.ANOMALY_DETECTION_ENABLED === 'true' && startAnomalyDetector) {
      startAnomalyDetector(io, logger);
      logger.info('✅ Anomaly detector started');
    }

    server.listen(PORT, HOST, () => {
      logger.info(`🚀 RemoteShield X Backend running on ${HOST}:${PORT}`);
      logger.info(`🔒 VPN subnet enforcement: ${process.env.VPN_SUBNET}`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

module.exports = { app, server, io };
