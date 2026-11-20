'use strict';
const { query } = require('../../backend/src/db/db');
const { withTenant } = require('../../backend/src/db/tenant');
const { scanOrganization } = require('../../backend/src/services/detection-engine');
function startAnomalyDetector(io, logger, config) {
  let stopped = false;
  let pending;
  async function run() {
    for (const organizationId of config.ANOMALY_ORGANIZATION_IDS.split(',')) {
      if (stopped) break;
      await withTenant(organizationId, async () => {
        let opened;
        try { opened = await scanOrganization(config); }
        catch {
          logger?.error({ event:'detection.scan_failed', organizationId });
          try {
            await query(`INSERT INTO detection_runs(last_attempt,state) VALUES(NOW(),'failed')
              ON CONFLICT(organization_id) DO UPDATE SET last_attempt=NOW(),state='failed'`);
          } catch { logger?.error({ event:'detection.health_write_failed', organizationId }); }
          return;
        }
        try {
          for (const alert of opened) await io?.emitToAdmins(organizationId, 'security_alert', alert);
        } catch { logger?.warn({ event:'detection.notification_failed', organizationId }); }
      });
    }
  }
  const schedule = () => {
    if (!pending && !stopped) pending = run().catch(() => logger?.error({ event:'detection.worker_failed' }))
      .finally(() => { pending = undefined; });
  };
  schedule();
  const timer = setInterval(schedule, config.DETECTION_INTERVAL_MS);
  logger?.info({ event:'detection.started', intervalMs:config.DETECTION_INTERVAL_MS });
  return async () => { stopped = true; clearInterval(timer); await pending; };
}
module.exports = { startAnomalyDetector };
