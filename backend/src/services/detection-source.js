'use strict';
const jwt = require('jsonwebtoken');
const { query } = require('../db/db');
const { withTenant } = require('../db/tenant');
const { hashToken } = require('./sessions');
const { enabled, observe } = require('./detection-signals');
async function recordRejectedSource(req, config, address) {
  if (!config.ANOMALY_DETECTION_ENABLED) return;
  const token = /^Bearer ([^ ]+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token || token.length > 4096) return;
  let claims;
  try { claims = jwt.verify(token, config.JWT_SECRET, { algorithms:['HS256'] }); } catch { return; }
  if (claims.type !== 'access' || !enabled(config, claims.organizationId)) return;
  await withTenant(claims.organizationId, async () => {
    const session = (await query(`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id JOIN organizations o ON o.id=u.organization_id
      WHERE s.user_id=$1 AND s.token_hash=$2 AND s.is_active AND s.expires_at>NOW() AND s.absolute_expires_at>NOW()
      AND u.is_active AND NOT u.is_locked AND o.is_active
      AND NOT EXISTS(SELECT 1 FROM devices d WHERE d.external_id=s.device_id AND (d.status='revoked' OR d.trust_state IN ('revoked','quarantined')))`, [claims.sub, hashToken(token)])).rows[0];
    if (!session) return;
    await observe({ ...req, app:req.app, ip:address, requestId:req.requestId }, 'vpn.source_rejected',
      { userId:claims.sub,sessionId:session.id,reason:'SOURCE_OUTSIDE_APPROVED_NETWORK' });
  });
}
module.exports = { recordRejectedSource };
