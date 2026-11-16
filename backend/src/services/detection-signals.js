'use strict';

const { createHmac, randomUUID } = require('node:crypto');
const { query } = require('../db/db');
const { tenantId } = require('../db/tenant');

function enabled(config, organizationId) {
  return !!config?.ANOMALY_DETECTION_ENABLED && config.ANOMALY_ORGANIZATION_IDS.split(',').includes(organizationId);
}

function fingerprint(config, organizationId, kind, value) {
  return value ? createHmac('sha256', config.JWT_SECRET).update('detection.v1.' + organizationId + '.' + kind + ':' + value).digest('hex') : null;
}

async function observe(req, eventType, { userId = req.user?.sub, sessionId = null, subject, device, trust = 'server_observed', reason } = {}) {
  const config = req.app?.locals?.config;
  if (!config?.ANOMALY_DETECTION_ENABLED) return;
  const organizationId = tenantId();
  if (!enabled(config, organizationId)) return;
  const subjectKey = subject || userId;
  if (!subjectKey) return;
  const address = req.networkSource?.address || req.vpnClientIp || req.ip;
  await query(`INSERT INTO detection_signals(user_id,session_id,event_type,subject_key,source_hash,device_hash,trust,reason,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organization_id,event_type,request_id) DO NOTHING`,
  [userId || null, sessionId, eventType, fingerprint(config, organizationId, 'subject', subjectKey),
    fingerprint(config, organizationId, 'source', address), fingerprint(config, organizationId, 'device', device), trust, reason || null, req.requestId || randomUUID()]);
}

module.exports = { enabled, observe };
