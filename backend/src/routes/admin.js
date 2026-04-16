'use strict';

const express = require('express');
const Joi = require('joi');
const { query } = require('../db/db');

const router = express.Router();

// All admin routes require role=admin (enforced by authenticateToken + role check in middleware)
router.use((req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});

// ─── GET /api/admin/sessions — Live session list ──────────────────────────────
router.get('/sessions', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        s.id, s.user_id, u.username, u.email,
        s.device_os, s.vpn_ip, s.public_ip,
        s.started_at, s.last_activity, s.expires_at, s.is_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.is_active = TRUE
      ORDER BY s.last_activity DESC
    `);
    res.json({ sessions: result.rows });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/force-logout — Force logout a user ──────────────────────
router.post('/force-logout', async (req, res, next) => {
  try {
    const { userId, sessionId } = req.body;
    if (!userId && !sessionId) return res.status(400).json({ error: 'userId or sessionId required' });

    if (sessionId) {
      await query('UPDATE sessions SET is_active=FALSE, ended_at=NOW() WHERE id=$1', [sessionId]);
    } else {
      await query('UPDATE sessions SET is_active=FALSE, ended_at=NOW() WHERE user_id=$1 AND is_active=TRUE', [userId]);
    }

    await query(
      `INSERT INTO audit_log (actor_id, action, target, ip_address)
       VALUES ($1, 'force_logout', $2, $3)`,
      [req.user.sub, userId || sessionId, req.ip]
    );

    const io = req.app.get('io');
    if (io) io.to('admin_room').emit('session_terminated', { userId, sessionId, by: req.user.sub });

    res.json({ message: 'Session(s) terminated' });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/ip-logs — IP activity log ────────────────────────────────
router.get('/ip-logs', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, flagged } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = '';
    const params = [parseInt(limit), offset];
    if (flagged === 'true') {
      whereClause = 'WHERE l.flagged = TRUE';
    }

    const result = await query(`
      SELECT
        l.id, l.request_ip, l.vpn_confirmed, l.url_requested,
        l.country_code, l.flagged, l.flag_reason, l.created_at,
        u.username
      FROM ip_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const countResult = await query(`SELECT COUNT(*) FROM ip_logs ${whereClause}`);
    res.json({
      logs: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) { next(err); }
});

// ─── GET/POST/DELETE /api/admin/blocked-urls ─────────────────────────────────
router.get('/blocked-urls', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM blocked_urls WHERE is_active=TRUE ORDER BY created_at DESC'
    );
    res.json({ blockedUrls: result.rows });
  } catch (err) { next(err); }
});

router.post('/blocked-urls', async (req, res, next) => {
  try {
    const schema = Joi.object({ pattern: Joi.string().max(500).required(), reason: Joi.string().max(255).optional() });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const result = await query(
      `INSERT INTO blocked_urls (pattern, blocked_by, reason) VALUES ($1, $2, $3)
       ON CONFLICT (pattern) DO UPDATE SET is_active=TRUE, reason=$3
       RETURNING *`,
      [value.pattern, req.user.sub, value.reason || null]
    );

    await query(
      `INSERT INTO audit_log (actor_id, action, target, ip_address)
       VALUES ($1, 'block_url', $2, $3)`,
      [req.user.sub, value.pattern, req.ip]
    );

    const io = req.app.get('io');
    if (io) io.to('admin_room').emit('url_blocked', result.rows[0]);

    res.status(201).json({ blockedUrl: result.rows[0] });
  } catch (err) { next(err); }
});

router.delete('/blocked-urls/:id', async (req, res, next) => {
  try {
    await query('UPDATE blocked_urls SET is_active=FALSE WHERE id=$1', [req.params.id]);
    await query(
      `INSERT INTO audit_log (actor_id, action, target, ip_address)
       VALUES ($1, 'unblock_url', $2, $3)`,
      [req.user.sub, req.params.id, req.ip]
    );
    res.json({ message: 'URL unblocked' });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/anomalies — Unresolved alerts ────────────────────────────
router.get('/anomalies', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT a.*, u.username FROM anomaly_alerts a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.resolved = FALSE
      ORDER BY a.created_at DESC
      LIMIT 100
    `);
    res.json({ anomalies: result.rows });
  } catch (err) { next(err); }
});

router.patch('/anomalies/:id/resolve', async (req, res, next) => {
  try {
    await query('UPDATE anomaly_alerts SET resolved=TRUE WHERE id=$1', [req.params.id]);
    res.json({ message: 'Alert resolved' });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/users — User management ───────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, username, email, role, is_active, is_locked, last_login, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (err) { next(err); }
});

router.patch('/users/:id/lock', async (req, res, next) => {
  try {
    const { locked } = req.body;
    await query('UPDATE users SET is_locked=$1 WHERE id=$2', [!!locked, req.params.id]);
    await query(
      `INSERT INTO audit_log (actor_id, action, target, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [req.user.sub, locked ? 'lock_user' : 'unlock_user', req.params.id, req.ip]
    );
    res.json({ message: `User ${locked ? 'locked' : 'unlocked'}` });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/stats — Dashboard overview ────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [activeSessionsRes, totalUsersRes, flaggedLogsRes, unresolvedAlertsRes] = await Promise.all([
      query('SELECT COUNT(*) FROM sessions WHERE is_active=TRUE'),
      query('SELECT COUNT(*) FROM users WHERE is_active=TRUE'),
      query('SELECT COUNT(*) FROM ip_logs WHERE flagged=TRUE AND created_at > NOW() - INTERVAL \'24 hours\''),
      query('SELECT COUNT(*) FROM anomaly_alerts WHERE resolved=FALSE'),
    ]);
    res.json({
      activeSessions: parseInt(activeSessionsRes.rows[0].count),
      totalUsers: parseInt(totalUsersRes.rows[0].count),
      flaggedLogs24h: parseInt(flaggedLogsRes.rows[0].count),
      unresolvedAlerts: parseInt(unresolvedAlertsRes.rows[0].count),
    });
  } catch (err) { next(err); }
});

module.exports = router;
