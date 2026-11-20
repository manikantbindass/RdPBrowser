'use strict';

const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = require('express').Router();
const { query, transaction } = require('../db/db');
const { Joi, validate, id, password, pagination, wrap, fail } = require('../services/validation');
const { audit } = require('../services/audit');
const { change } = require('../services/governance-change');
const { managedUser } = require('../services/admin-roles');
const { gatewayHealth } = require('../services/gateway-snapshot');

router.get('/account', wrap(async (req, res) => {
  const { session } = req.accessContext;
  const { rows } = await query('SELECT id,username,email,role,last_login FROM users WHERE id=$1', [req.user.sub]);
  if (!rows[0]) fail(404, 'Account unavailable');
  res.set('Cache-Control', 'no-store');
  res.json({
    account: rows[0],
    session: { id: session.id, expiresAt: session.expires_at, authenticationMethod: session.authentication_method,
      mfaVerified: session.mfa_verified },
  });
}));

const passwordLimit = rateLimit({ windowMs: 900000, max: 5, keyGenerator: req => req.user.sub,
  standardHeaders: true, legacyHeaders: false });
router.put('/account/password', passwordLimit, wrap(async (req, res) => {
  const value = validate(Joi.object({
    currentPassword: Joi.string().min(1).max(72).custom((v, h) => Buffer.byteLength(v) > 72 ? h.error('any.invalid') : v).required(),
    newPassword: password.required(),
  }), req.body);
  if (req.accessContext.session.authentication_method !== 'password') fail(403, 'Manage credentials with your identity provider');
  if (value.currentPassword === value.newPassword) fail(400, 'Choose a different password');
  await transaction(async () => {
    const { rows } = await query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [req.user.sub]);
    if (!rows[0] || !await bcrypt.compare(value.currentPassword, rows[0].password_hash)) {
      fail(403, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
    }
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(value.newPassword, 12), req.user.sub]);
    await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1 AND is_active', [req.user.sub]);
    await audit(req, 'account.password_change', req.user.sub);
  });
  res.json({ message: 'Password changed. Sign in again.' });
}));

router.patch('/users/:id/role', wrap(async (req, res) => {
  if (req.user.role !== 'superadmin') fail(403, 'Superadmin access required', 'SUPERADMIN_REQUIRED');
  const userId = validate(id.required(), req.params.id);
  const { role } = validate(Joi.object({ role: Joi.string().valid('user', 'admin').required() }), req.body);
  await transaction(async () => {
    const user = await managedUser(req.user, userId);
    if (user.directory_id) fail(409,'Directory-managed roles require a group mapping','DIRECTORY_MANAGED_ROLE');
    if (user.role === role) return;
    await query('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
    await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1 AND is_active', [userId]);
    await change(req, `user.role_${role}`, userId, { role:user.role }, { role });
  });
  res.json({ message: 'Role updated', role });
}));

router.get('/audit-log', wrap(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const action = req.query.action === undefined ? null :
    validate(Joi.string().pattern(/^[a-z][a-z0-9_.]{0,99}$/), req.query.action);
  const { rows } = await query(`SELECT a.id,a.actor_id,u.username AS actor,a.actor_kind,a.provisioning_credential_id,a.action,a.target,a.request_id,a.created_at
    FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id AND u.organization_id=a.organization_id
    WHERE ($1::text IS NULL OR a.action=$1) ORDER BY a.created_at DESC,a.id LIMIT $2 OFFSET $3`, [action, limit, offset]);
  res.json({ entries: rows, page, limit });
}));

router.get('/security-summary', wrap(async (req, res) => {
  const { rows } = await query(`WITH days AS (
      SELECT generate_series(
        (now() AT TIME ZONE 'UTC')::date-6,(now() AT TIME ZONE 'UTC')::date,'1 day'
      )::date AS day
    ), decisions AS (
      SELECT (created_at AT TIME ZONE 'UTC')::date AS day,COUNT(*)::int AS count
      FROM access_decisions WHERE outcome='deny' AND created_at>=((now() AT TIME ZONE 'UTC')::date-6)::timestamp AT TIME ZONE 'UTC'
      GROUP BY 1
    ), reports AS (
      SELECT (created_at AT TIME ZONE 'UTC')::date AS day,COUNT(*)::int AS count
      FROM security_events WHERE created_at>=((now() AT TIME ZONE 'UTC')::date-6)::timestamp AT TIME ZONE 'UTC'
      GROUP BY 1
    )
    SELECT days.day::text AS day,COALESCE(decisions.count,0) AS denials,COALESCE(reports.count,0) AS reports
    FROM days LEFT JOIN decisions USING(day) LEFT JOIN reports USING(day) ORDER BY days.day`);
  res.json({ days: rows });
}));

router.get('/devices', wrap(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const status = req.query.status === undefined ? null : validate(Joi.string().valid('registered', 'revoked'), req.query.status);
  const { rows } = await query(`SELECT d.id,d.user_id,d.name,d.platform,d.status,d.trust_state,d.posture_valid_until,d.created_at,
    d.public_key IS NOT NULL AS key_enrolled,u.username,u.role
    FROM devices d JOIN users u ON d.user_id=u.id AND d.organization_id=u.organization_id
    WHERE ($1::text IS NULL OR d.status=$1) ORDER BY d.created_at DESC,d.id LIMIT $2 OFFSET $3`, [status, limit, offset]);
  res.json({ devices: rows, page, limit });
}));

router.get('/network-health', wrap(async (req, res) => {
  const [result, gateway] = await Promise.all([query(`SELECT COUNT(*) FILTER (WHERE vpn_confirmed)::int AS accepted,
    COUNT(*)::int AS observed,MAX(created_at) FILTER (WHERE vpn_confirmed) AS last_accepted
    FROM ip_logs WHERE created_at>=NOW()-INTERVAL '24 hours'`), gatewayHealth(req.app.locals.config.VPN_PEER_STATUS_FILE)]);
  res.set('Cache-Control', 'no-store');
  res.json({ sourceGate: req.networkSource.state, observedAddress: req.networkSource.address,
    sourceMode: req.app.locals.config.VPN_SOURCE_MODE, observations: result.rows[0], gateway });
}));

router.get('/policies/:id/versions', wrap(async (req, res) => {
  const policyId = validate(id.required(), req.params.id);
  const { limit, offset, page } = pagination(req);
  if (!(await query('SELECT 1 FROM policies WHERE id=$1', [policyId])).rowCount) fail(404, 'Resource not found');
  const { rows } = await query(`SELECT v.revision,v.name,v.rules,v.is_active,v.assignment,v.created_at,u.username AS actor
    FROM policy_versions v LEFT JOIN users u ON u.id=v.actor_id AND u.organization_id=v.organization_id
    WHERE v.policy_id=$1 ORDER BY v.revision DESC LIMIT $2 OFFSET $3`, [policyId, limit, offset]);
  res.json({ versions: rows, page, limit });
}));

module.exports = router;
