'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db/db');
const { withTenant,DEFAULT_ORGANIZATION } = require('../db/tenant');
const { loadPolicy,resourceFor,decide,recordDecision }=require('../services/access');

/**
 * JWT Authentication Middleware
 * Validates Bearer token, checks session is active in DB.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, req.app.locals.config.JWT_SECRET, { algorithms:['HS256'] });
    if (payload.type && payload.type!=='access') return res.status(401).json({ error:'Invalid token type',code:'INVALID_TOKEN' });
    const organizationId = payload.organizationId || DEFAULT_ORGANIZATION;

    // Verify session is still active in DB (catches force-logout)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return await withTenant(organizationId, async () => {
    const sessionResult = await query(
      `SELECT s.*,u.role,u.is_active AS user_active,u.is_locked,u.organization_id AS user_organization_id,o.is_active AS organization_active
       FROM sessions s JOIN users u ON u.id=s.user_id AND u.organization_id=s.organization_id
       JOIN organizations o ON o.id=s.organization_id
       WHERE s.token_hash = $1 AND s.user_id = $2 AND s.is_active AND u.is_active AND NOT u.is_locked AND o.is_active
       AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.external_id=s.device_id AND (d.status='revoked' OR d.trust_state IN ('revoked','quarantined')))`,
      [tokenHash, payload.sub]
    );

    if (!sessionResult.rows.length || !sessionResult.rows[0].is_active) {
      return res.status(401).json({ error: 'Session terminated or expired. Please login again.', code: 'SESSION_EXPIRED' });
    }

    if (new Date(sessionResult.rows[0].expires_at) < new Date()) {
      await query('UPDATE sessions SET is_active=FALSE, ended_at=NOW() WHERE id=$1', [sessionResult.rows[0].id]);
      return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
    }

    req.user = { ...payload, organizationId, role:sessionResult.rows[0].role };
    req.sessionId = sessionResult.rows[0].id;
    const session=sessionResult.rows[0];
    const device=session.registered_device_id ? (await query('SELECT * FROM devices WHERE id=$1 AND user_id=$2',[session.registered_device_id,payload.sub])).rows[0] :
      session.device_id ? (await query('SELECT * FROM devices WHERE external_id=$1',[session.device_id])).rows[0] : null;
    const policy=await loadPolicy();
    const principal={ id:payload.sub,role:session.role,is_active:session.user_active,is_locked:session.is_locked,
      organization_id:session.user_organization_id,organization_active:session.organization_active };
    const decision=decide({ user:principal,session,device,resource:resourceFor(req),policy:policy.configuration });
    if (session.registered_device_id && !device) decision.allowed=false,decision.reason='DEVICE_INVALID';
    await recordDecision(req,principal,session,device,decision,policy.revision);
    if (!decision.allowed) return res.status(403).json({ error:'Access policy denied request',code:decision.reason });
    // Successful validation extends idle activity, never authentication or absolute lifetime.
    await query('UPDATE sessions SET last_activity=NOW() WHERE id=$1',[session.id]);
    req.accessContext={ user:principal,session,device,policy };
    next();
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
    next(err);
  }
}

module.exports = { authenticateToken };
