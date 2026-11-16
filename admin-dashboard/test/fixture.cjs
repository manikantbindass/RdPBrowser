'use strict';

const { randomUUID, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const path = require('node:path');
const { Pool } = require('../../backend/node_modules/pg');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const express = require('../../backend/node_modules/express');
const { createApp } = require('../../backend/src/http/app');
const { loadConfig } = require('../../backend/src/config');
const db = require('../../backend/src/db/db');
const { migrate } = require('../../backend/src/db/migrations');
const { provision } = require('../../backend/src/db/provision');
const { DEFAULT_ORGANIZATION, withTenant } = require('../../backend/src/db/tenant');
const { attachRealtime } = require('../../backend/src/realtime');

async function startFixture() {
  const url = new URL(process.env.INTEGRATION_DATABASE_URL || 'postgresql://invalid/absent');
  if (!url.pathname.endsWith('_test') || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('A disposable loopback INTEGRATION_DATABASE_URL ending in _test is required.');
  }
  const suffix = randomUUID().replaceAll('-', '');
  const schema = 'console_' + suffix;
  const role = 'consoleapp_' + suffix;
  const roleSecret = randomBytes(24).toString('hex');
  const password = 'Console1!' + randomBytes(10).toString('hex');
  const owner = new Pool({ connectionString: url.toString() });
  let pool;
  let realtime;
  let server;
  async function close() {
    try {
      if (realtime) await realtime.io.close();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await db.close();
      if (pool) await pool.end();
      await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await owner.query(`DROP ROLE IF EXISTS ${role}`);
    } finally {
      await owner.end();
    }
  }
  try {
    await owner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
    await owner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
    await owner.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', '-c search_path=' + schema + ',public');
    pool = new Pool({ connectionString: url.toString() });
    await migrate(pool);
    await provision(pool, { schema, role, password: roleSecret });
    const hash = await bcrypt.hash(password, 4);
    await pool.query("UPDATE organizations SET name='Console verification lab' WHERE id=$1", [DEFAULT_ORGANIZATION]);
    const member = (await pool.query(`INSERT INTO users(organization_id,username,email,password_hash,role)
      VALUES($1,'memberone','member@console.test',$2,'user') RETURNING id`, [DEFAULT_ORGANIZATION, hash])).rows[0].id;
    await pool.query(`INSERT INTO users(organization_id,username,email,password_hash,role)
      VALUES($1,'operator','operator@console.test',$2,'superadmin')`, [DEFAULT_ORGANIZATION, hash]);
    await pool.query(`INSERT INTO devices(organization_id,user_id,external_id,name,platform)
      VALUES($1,$2,'console-fixture-device','<img src=x onerror=alert(1)>','android')`, [DEFAULT_ORGANIZATION, member]);
    await pool.query(`INSERT INTO security_events(organization_id,user_id,event_type,severity,client_event_id,occurred_at)
      VALUES($1,$2,'fixture.browser_denied','high',$3,NOW())`, [DEFAULT_ORGANIZATION, member, randomUUID()]);
    await pool.query(`INSERT INTO anomaly_alerts(organization_id,user_id,alert_type,severity)
      VALUES($1,$2,'review_required','high')`, [DEFAULT_ORGANIZATION, member]);
    url.username = role;
    url.password = roleSecret;
    const host = express();
    host.use('/admin', express.static(path.resolve(__dirname, '..'), { fallthrough: false, dotfiles: 'deny' }));
    server = host.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), JWT_SECRET: randomBytes(32).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(32).toString('hex'), VPN_REQUIRED: 'false', CORS_ORIGINS: origin, RATE_LIMIT_MAX: '1000',
      AUTH_RATE_LIMIT_MAX: '100', MAX_SESSIONS_PER_USER: '5', ANOMALY_DETECTION_ENABLED:'true' });
    const logger = { info() {}, warn() {}, error() {} };
    db.configure(config, logger);
    await db.initDB();
    const app = createApp({ config, logger, database: db });
    host.use(app);
    realtime = attachRealtime({ server, config, logger });
    app.set('io', realtime.io);
    async function detectionFixture() {
      const { observe } = require('../../backend/src/services/detection-signals');
      const { scanOrganization } = require('../../backend/src/services/detection-engine');
      return withTenant(DEFAULT_ORGANIZATION, async () => {
        await observe({ app,ip:'192.0.2.5',requestId:randomUUID(),user:{ sub:member } },'client.vpn_bypass',{ trust:'client_report' });
        const alerts = await scanOrganization(config);
        for (const alert of alerts) await realtime.io.emitToAdmins(DEFAULT_ORGANIZATION,'security_alert',alert);
        return alerts;
      });
    }
    return { origin, password, close, detectionFixture };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { startFixture };
