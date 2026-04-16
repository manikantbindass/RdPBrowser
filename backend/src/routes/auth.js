'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const { query } = require('../db/db');
const crypto = require('crypto');

const router = express.Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────
const loginSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(80).required(),
  password: Joi.string().min(8).max(128).required(),
  deviceId: Joi.string().max(255).optional(),
  deviceOs: Joi.string().valid('windows', 'linux', 'macos', 'android').optional(),
});

const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(80).required(),
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(12)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .required()
    .messages({ 'string.pattern.base': 'Password must contain uppercase, lowercase, digit, and special char' }),
  deviceId: Joi.string().max(255).optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateTokens(userId, role, deviceId) {
  const accessToken = jwt.sign(
    { sub: userId, role, deviceId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  const refreshToken = jwt.sign(
    { sub: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { username, email, password, deviceId } = value;

    // Check duplicate
    const existing = await query('SELECT id FROM users WHERE username=$1 OR email=$2', [username, email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO users (username, email, password_hash, device_id)
       VALUES ($1, $2, $3, $4) RETURNING id, username, role`,
      [username, email, passwordHash, deviceId || null]
    );

    const user = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(user.id, user.role, deviceId);

    // Log audit
    await query(
      `INSERT INTO audit_log (actor_id, action, ip_address) VALUES ($1, 'register', $2)`,
      [user.id, req.vpnClientIp || req.ip]
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: { id: user.id, username: user.username, role: user.role },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { username, password, deviceId, deviceOs } = value;

    const result = await query(
      'SELECT id, username, password_hash, role, device_id, is_active, is_locked FROM users WHERE username=$1',
      [username]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
    if (user.is_locked) return res.status(403).json({ error: 'Account locked — contact admin' });

    // Device binding check
    if (process.env.DEVICE_BINDING_ENABLED === 'true' && user.device_id && user.device_id !== deviceId) {
      await query(
        `INSERT INTO anomaly_alerts (user_id, alert_type, severity, details)
         VALUES ($1, 'device_mismatch', 'high', $2)`,
        [user.id, JSON.stringify({ expected: user.device_id, received: deviceId })]
      );
      return res.status(403).json({ error: 'Device not authorized for this account' });
    }

    // Enforce single session
    const maxSessions = parseInt(process.env.MAX_SESSIONS_PER_USER) || 1;
    await query(
      `UPDATE sessions SET is_active=FALSE, ended_at=NOW()
       WHERE user_id=$1 AND is_active=TRUE
       AND id NOT IN (SELECT id FROM sessions WHERE user_id=$1 AND is_active=TRUE ORDER BY started_at DESC LIMIT $2)`,
      [user.id, maxSessions - 1]
    );

    const { accessToken, refreshToken } = generateTokens(user.id, user.role, deviceId);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    await query(
      `INSERT INTO sessions (user_id, token_hash, device_id, device_os, vpn_ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, hashToken(accessToken), deviceId || null, deviceOs || null, req.vpnClientIp || null, expiresAt]
    );

    await query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    await query(
      `INSERT INTO audit_log (actor_id, action, ip_address, metadata)
       VALUES ($1, 'login', $2, $3)`,
      [user.id, req.vpnClientIp || req.ip, JSON.stringify({ deviceOs, deviceId })]
    );

    // Emit to admin dashboard
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('user_logged_in', {
        userId: user.id,
        username: user.username,
        deviceOs,
        vpnIp: req.vpnClientIp,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      message: 'Login successful',
      user: { id: user.id, username: user.username, role: user.role },
      accessToken,
      refreshToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    if (payload.type !== 'refresh') throw new Error('Invalid token type');

    const userResult = await query('SELECT id, username, role, device_id FROM users WHERE id=$1', [payload.sub]);
    const user = userResult.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    const { accessToken, refreshToken: newRefresh } = generateTokens(user.id, user.role, user.device_id);
    res.json({ accessToken, refreshToken: newRefresh });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    next(err);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(400).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    const tokenHash = hashToken(token);

    await query(
      'UPDATE sessions SET is_active=FALSE, ended_at=NOW() WHERE token_hash=$1',
      [tokenHash]
    );

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
