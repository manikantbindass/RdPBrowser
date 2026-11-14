'use strict';
const http = require('http');
const { createApp } = require('./http/app');
const { attachRealtime } = require('./realtime');
function createRuntime({ config, logger, database }) {
  database.configure(config, logger);
  const app = createApp({ config, logger, database });
  const server = http.createServer(app);
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=1000;
  const { io, activeSessions } = attachRealtime({ server, config, logger });
  app.set('io', io); app.set('activeSessions', activeSessions);
  let stopDetector;
  let stopping;
  async function start() {
    try {
      await database.initDB();
      if (config.ANOMALY_DETECTION_ENABLED) stopDetector = require('../../security/anomaly-detector/detector').startAnomalyDetector(io, logger, config);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.PORT, config.HOST, () => { server.off('error', reject); resolve(); });
      });
      logger.info({ event: 'server.started', host: config.HOST, port: config.PORT, apiVersion: '1', trafficEnforcement: 'external' });
    } catch (err) {
      logger.error({ event: 'server.start_failed', code: err.code || 'STARTUP_FAILED' });
      await stop(); throw err;
    }
  }
  function stop() {
    if (!stopping) stopping=shutdown();
    return stopping;
  }
  async function shutdown() {
    app.locals.draining=true;
    if (stopDetector) { await stopDetector(); stopDetector = undefined; }
    const timeout = setTimeout(() => server.closeAllConnections(), 5000); timeout.unref();
    try {
      await new Promise((resolve, reject) => io.close(err => err && err.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(err) : resolve()));
      await database.close();
    } finally { clearTimeout(timeout); }
  }
  return { app, server, io, start, stop };
}
module.exports = { createRuntime };
