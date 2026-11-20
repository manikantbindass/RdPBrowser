'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { query, transaction } = require('../db/db');
const { tenantId } = require('../db/tenant');
const { rules, evaluate } = require('../../../security/anomaly-detector/rules');
const MAX_SIGNALS = 2000;

async function scanOrganization(config) {
  return transaction(async () => {
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,10))', [tenantId()]);
    const now = (await query('SELECT NOW() AS now')).rows[0].now;
    const opened = [];
    let capacity = false;
    for (const rule of rules) {
      // Keep the transaction timestamp at PostgreSQL precision for both window bounds.
      const result = await query(`SELECT s.* FROM detection_signals s WHERE event_type=ANY($1::text[])
        AND created_at>=NOW()-($2::int*INTERVAL '1 second') AND created_at<=NOW()
        AND NOT EXISTS(SELECT 1 FROM detection_evidence e WHERE e.rule_id=$3 AND e.signal_id=s.id)
        ORDER BY created_at,id LIMIT $4`, [rule.events, rule.window, rule.id, MAX_SIGNALS + 1]);
      if (result.rows.length > MAX_SIGNALS) capacity = true;
      for (const hit of evaluate(rule, result.rows.slice(0, MAX_SIGNALS), new Date(now).getTime())) {
        const candidate = randomUUID();
        const subject = createHash('sha256').update(hit.subject).digest('hex');
        const userId = rule.id === 'password_spray' ? null : hit.evidence[0].user_id;
        const sessionId = rule.group === 'session_id' ? hit.subject : null;
        const row = (await query(`INSERT INTO anomaly_alerts(id,user_id,session_id,alert_type,severity,details,
          rule_id,rule_version,subject_key,confidence,explanation,first_seen,last_seen,evidence_count)
          VALUES($1,$2,$3,$4,$5,$6,$4,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT(organization_id,rule_id,subject_key) WHERE rule_id IS NOT NULL AND status IN ('open','investigating')
          DO UPDATE SET last_seen=EXCLUDED.last_seen,evidence_count=anomaly_alerts.evidence_count+EXCLUDED.evidence_count
          RETURNING id`, [candidate, userId, sessionId, rule.id, rule.severity, { threshold:rule.threshold, windowSeconds:rule.window },
        rule.version, subject, rule.confidence, rule.explanation, hit.evidence[0].created_at,
        hit.evidence[hit.evidence.length - 1].created_at, hit.evidence.length])).rows[0];
        for (const signal of hit.evidence) {
          await query(`INSERT INTO detection_evidence(incident_id,signal_id,rule_id,event_type,trust,reason,request_id,observed_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [row.id, signal.id, rule.id, signal.event_type, signal.trust, signal.reason, signal.request_id, signal.created_at]);
        }
        await query("INSERT INTO audit_log(action,target,request_id) VALUES('detection.rule_triggered',$1,$2)", [row.id, randomUUID()]);
        if (row.id === candidate) opened.push({ id:row.id, ruleId:rule.id, severity:rule.severity });
      }
    }
    await query("DELETE FROM detection_signals WHERE created_at<NOW()-($1::int*INTERVAL '1 day')", [config.DETECTION_SIGNAL_RETENTION_DAYS]);
    await query(`INSERT INTO detection_runs(last_attempt,last_success,state,incidents_opened) VALUES(NOW(),NOW(),$1,$2)
      ON CONFLICT(organization_id) DO UPDATE SET last_attempt=NOW(),last_success=NOW(),state=$1,
      incidents_opened=detection_runs.incidents_opened+$2`, [capacity ? 'capacity_exceeded' : 'healthy', opened.length]);
    return opened;
  });
}
module.exports = { scanOrganization, MAX_SIGNALS };
