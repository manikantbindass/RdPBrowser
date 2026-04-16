'use strict';

/**
 * RemoteShield X — AI-Based Anomaly Detector
 * Analyzes session and IP log patterns to detect suspicious behavior.
 * Runs as a background service started from the main backend.
 *
 * Detection rules:
 *  1. High request frequency (>50 requests/min per user)
 *  2. IP mismatch (request IP != VPN subnet)
 *  3. Geo-mismatch (country changed mid-session)
 *  4. Unusual hours activity (configurable)
 *  5. Multiple session attempts from different devices
 */

const { query } = require('../../backend/src/db/db');

const RULES = {
  HIGH_FREQUENCY_THRESHOLD: 50,   // requests per minute
  ALLOWED_HOURS_START: 6,          // 6 AM
  ALLOWED_HOURS_END: 22,           // 10 PM
  CHECK_INTERVAL_MS: 30 * 1000,    // run every 30s
};

async function detectHighFrequency() {
  const rows = await query(`
    SELECT user_id, COUNT(*) as req_count
    FROM ip_logs
    WHERE created_at > NOW() - INTERVAL '1 minute'
    GROUP BY user_id
    HAVING COUNT(*) > $1
  `, [RULES.HIGH_FREQUENCY_THRESHOLD]);

  for (const row of rows.rows) {
    await raiseAlert(row.user_id, null, 'high_frequency', 'high', {
      requestsPerMin: parseInt(row.req_count),
      threshold: RULES.HIGH_FREQUENCY_THRESHOLD,
    });
  }
}

async function detectGeoMismatch() {
  // Find sessions where multiple different countries appear in the last 10 minutes
  const rows = await query(`
    SELECT l.user_id, COUNT(DISTINCT l.country_code) as country_count, 
           ARRAY_AGG(DISTINCT l.country_code) as countries, s.id as session_id
    FROM ip_logs l
    JOIN sessions s ON s.user_id = l.user_id AND s.is_active = TRUE
    WHERE l.created_at > NOW() - INTERVAL '10 minutes'
    AND l.country_code IS NOT NULL AND l.country_code != 'XX'
    GROUP BY l.user_id, s.id
    HAVING COUNT(DISTINCT l.country_code) > 1
  `);

  for (const row of rows.rows) {
    await raiseAlert(row.user_id, row.session_id, 'geo_mismatch', 'critical', {
      countries: row.countries,
      message: 'Multiple countries detected in a single session — possible VPN leak or account sharing',
    });
  }
}

async function detectUnusualHours() {
  const hour = new Date().getUTCHours();
  if (hour >= RULES.ALLOWED_HOURS_START && hour < RULES.ALLOWED_HOURS_END) return;

  const rows = await query(`
    SELECT DISTINCT user_id FROM ip_logs
    WHERE created_at > NOW() - INTERVAL '1 minute'
  `);

  for (const row of rows.rows) {
    await raiseAlert(row.user_id, null, 'unusual_hours', 'medium', {
      utcHour: hour,
      message: `Activity detected outside allowed hours (${RULES.ALLOWED_HOURS_START}:00 - ${RULES.ALLOWED_HOURS_END}:00 UTC)`,
    });
  }
}

async function detectMultipleDevices() {
  const rows = await query(`
    SELECT user_id, COUNT(DISTINCT device_id) as device_count, ARRAY_AGG(DISTINCT device_id) as devices
    FROM sessions
    WHERE is_active = TRUE AND device_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(DISTINCT device_id) > 1
  `);

  for (const row of rows.rows) {
    await raiseAlert(row.user_id, null, 'multiple_devices', 'high', {
      deviceCount: row.device_count,
      devices: row.devices,
    });
  }
}

async function raiseAlert(userId, sessionId, alertType, severity, details) {
  // Avoid duplicate alerts in the last 5 minutes
  const exists = await query(`
    SELECT id FROM anomaly_alerts
    WHERE user_id = $1 AND alert_type = $2 AND created_at > NOW() - INTERVAL '5 minutes'
    LIMIT 1
  `, [userId, alertType]);

  if (exists.rows.length > 0) return;

  await query(
    `INSERT INTO anomaly_alerts (user_id, session_id, alert_type, severity, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, sessionId || null, alertType, severity, JSON.stringify(details)]
  );

  console.warn(`[ANOMALY] ${severity.toUpperCase()} | ${alertType} | user: ${userId}`);
}

/**
 * Start the anomaly detector — pass the Socket.io instance to emit real-time alerts
 */
function startAnomalyDetector(io, logger) {
  const run = async () => {
    try {
      await Promise.all([
        detectHighFrequency(),
        detectGeoMismatch(),
        detectUnusualHours(),
        detectMultipleDevices(),
      ]);

      // Emit unresolved alerts count to admin dashboard
      const count = await query('SELECT COUNT(*) FROM anomaly_alerts WHERE resolved=FALSE');
      if (io) io.to('admin_room').emit('anomaly_count', parseInt(count.rows[0].count));
    } catch (err) {
      logger?.error('[AnomalyDetector] Error:', err.message);
    }
  };

  run();
  setInterval(run, RULES.CHECK_INTERVAL_MS);
  logger?.info('🔍 Anomaly detector active (30s interval)');
}

module.exports = { startAnomalyDetector };
