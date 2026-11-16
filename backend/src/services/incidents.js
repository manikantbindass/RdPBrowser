'use strict';
const { query, transaction } = require('../db/db');
const { tenantId } = require('../db/tenant');
const { fail } = require('./validation');
const { audit } = require('./audit');
const { managedUser } = require('./admin-roles');
async function incident(id, lock = false) {
  const row = (await query('SELECT * FROM anomaly_alerts WHERE id=$1' + (lock ? ' FOR UPDATE' : ''), [id])).rows[0];
  if (!row) fail(404, 'Alert not found');
  return row;
}
async function review(req, id, value, reviewAction = 'incident.review') {
  return transaction(async () => {
    // Same lock order as the scanner avoids review/reopen races.
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,10))', [tenantId()]);
    const row = await incident(id, true);
    if (value.revision !== undefined && row.review_revision !== value.revision) fail(409, 'Alert revision conflict', 'REVISION_CONFLICT');
    if (value.action) {
      if (row.resolved) fail(409, 'Review a closed alert before responding');
      if (!row.user_id) fail(409, 'Alert has no attributable account');
      await managedUser(req.user, row.user_id);
      if (value.action === 'lock_user') {
        await query('UPDATE users SET is_locked=TRUE WHERE id=$1', [row.user_id]);
        await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1', [row.user_id]);
      } else {
        if (!row.session_id) fail(409, 'Alert has no attributable session');
        const result = await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE id=$1 AND user_id=$2 RETURNING id', [row.session_id, row.user_id]);
        if (!result.rowCount) fail(409, 'Session unavailable');
      }
    }
    const status = value.action ? 'investigating' : value.status;
    const disposition = value.action ? 'pending' : value.disposition;
    // Reopening a closed incident can conflict with a newer open incident for the rule.
    if (row.resolved && ['open','investigating'].includes(status) && row.rule_id) {
      const active = await query("SELECT id FROM anomaly_alerts WHERE rule_id=$1 AND subject_key=$2 AND status IN ('open','investigating') AND id<>$3", [row.rule_id,row.subject_key,id]);
      if (active.rowCount) fail(409, 'A newer incident is already open', 'INCIDENT_ALREADY_OPEN');
    }
    const updated = (await query(`UPDATE anomaly_alerts SET status=$2,disposition=$3,resolved=$4,
      assigned_to=$5,review_revision=review_revision+1 WHERE id=$1 RETURNING *`,
    [id, status, disposition, ['resolved','dismissed'].includes(status), status === 'open' ? null : req.user.sub])).rows[0];
    await query(`INSERT INTO incident_reviews(incident_id,actor_id,status,disposition,revision,response)
      VALUES($1,$2,$3,$4,$5,$6)`, [id, req.user.sub, status, disposition, updated.review_revision, value.action || null]);
    await audit(req, value.action ? 'incident.' + value.action : reviewAction, id);
    return updated;
  });
}
module.exports = { incident, review };
