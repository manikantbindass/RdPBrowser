'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('../routes/auth');
const adminRoutes = require('../routes/admin');
const proxyRoutes = require('../routes/proxy');
const lailaRoutes = require('../routes/laila');
const { vpnCheck } = require('../middleware/vpnCheck');
const { authenticateToken } = require('../middleware/auth');
const { requestContext, errorHandler } = require('./errors');

function createApp({ config, logger, database }) {
  const app = express();
  app.locals.config = config;
  app.set('logger', logger);
  app.set('trust proxy', config.trustedProxies.length ? config.trustedProxies : false);
  app.use(requestContext);
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info({ event: 'http.completed', requestId: req.requestId, method: req.method,
        path: req.route?.path || 'unmatched', status: res.statusCode, durationMs: Number(process.hrtime.bigint() - start) / 1e6 });
      if ([401,403].includes(res.statusCode)) logger.warn({ event:'access.denied',requestId:req.requestId,status:res.statusCode,resource:req.route?.path || 'unmatched' });
    });
    next();
  });
  app.use(helmet());
  app.use((req, res, next) => {
    if (!config.trustedProxies.length) {
      delete req.headers['x-forwarded-for']; delete req.headers['x-forwarded-host']; delete req.headers['x-forwarded-proto'];
    }
    next();
  });
  app.use(cors({ origin: (origin, cb) => {
    if (!origin || config.origins.includes(origin)) return cb(null, true);
    cb(Object.assign(new Error('Origin denied'), { status: 403, code: 'ORIGIN_DENIED', publicMessage: 'Origin not allowed' }));
  }, credentials: true }));
  app.use(rateLimit({ windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX, standardHeaders: true, legacyHeaders: false,
    skip:req => req.method==='GET' && ['/health','/ready'].includes(req.path),
    handler: (req, res) => res.status(429).json({ error: 'Too many requests, please try again later.' }) }));
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'RemoteShield X Backend' }));
  app.get('/ready', async (req, res) => {
    if (app.locals.draining) return res.status(503).json({ error:'Server shutting down',code:'NOT_READY' });
    try { await database.checkReady(); res.json({ status: 'ready' }); }
    catch { res.status(503).json({ error: 'Database or schema unavailable', code: 'NOT_READY' }); }
  });
  app.get('/api/v1/meta', (req, res) => res.json({ apiVersion: '1', service: 'RemoteShield X', trafficEnforcement: 'external', experimentalSsh: config.SSH_ENABLED }));
  app.use((req, res, next) => {
    const version = req.path.match(/^\/api\/v(\d+)(?:\/|$)/);
    if (version && version[1] !== '1') return res.status(404).json({ error: 'Unsupported API version', code: 'API_VERSION_UNSUPPORTED' });
    next();
  });
  const api = express.Router();
  api.use('/laila', lailaRoutes); // Preserve existing explicitly public search route.
  api.use(vpnCheck);
  api.use('/auth', rateLimit({ windowMs:config.RATE_LIMIT_WINDOW_MS, max:config.AUTH_RATE_LIMIT_MAX,
    standardHeaders:true,legacyHeaders:false, handler:(req,res) => res.status(429).json({ error:'Too many authentication requests' }) }));
  api.use('/auth',(req,res,next) => { res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');next(); },authRoutes);
  api.use('/admin', authenticateToken, adminRoutes);
  api.use('/proxy', authenticateToken, proxyRoutes); // Compatibility name: policy decisions, not network proxying.
  api.use((req,res,next) => /^\/(organization|users|devices|sessions|policies|events)(\/|$)/.test(req.path) ? authenticateToken(req,res,next) : next(), require('../routes/enterprise'));
  api.use(require('../routes/identity'));
  app.use('/api/v1', api);
  app.use('/api', (req, res, next) => { res.setHeader('Link', '</api/v1>; rel="successor-version"'); next(); }, api);
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler(logger));
  return app;
}
module.exports = { createApp };
