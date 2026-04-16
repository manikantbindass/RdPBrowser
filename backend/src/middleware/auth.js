'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db/db');

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
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Verify session is still active in DB (catches force-logout)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const sessionResult = await query(
      `SELECT s.id, s.is_active, s.expires_at
       FROM sessions s
       WHERE s.token_hash = $1 AND s.user_id = $2`,
      [tokenHash, payload.sub]
    );

    if (!sessionResult.rows.length || !sessionResult.rows[0].is_active) {
      return res.status(401).json({ error: 'Session terminated or expired. Please login again.', code: 'SESSION_EXPIRED' });
    }

    if (new Date(sessionResult.rows[0].expires_at) < new Date()) {
      await query('UPDATE sessions SET is_active=FALSE, ended_at=NOW() WHERE id=$1', [sessionResult.rows[0].id]);
      return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
    }

    req.user = payload;
    req.sessionId = sessionResult.rows[0].id;
    next();
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
