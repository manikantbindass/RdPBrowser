'use strict';
// Disposable native-UI acceptance server. Never a production account or deployment.
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const { once } = require('events');
const bcrypt = require('bcryptjs');
const { migrate } = require('../src/db/migrations');
const { provision } = require('../src/db/provision');
const { DEFAULT_ORGANIZATION } = require('../src/db/tenant');
const { loadConfig } = require('../src/config');
const { createRuntime } = require('../src/runtime');
const database = require('../src/db/db');
const url = process.env.INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Dedicated test DB required');
const schema = 'desktop_' + crypto.randomUUID().replace(/-/g, ''),
  role = 'test_' + crypto.randomUUID().replace(/-/g, '');
const password = crypto.randomBytes(32).toString('hex'),
  loginPassword = crypto.randomBytes(24).toString('hex');
const owner = new Pool({
  connectionString: url,
  connectionTimeoutMillis: 5000,
});
let pool, runtime, pagesServer;
let stage = 'database setup';
(async () => {
  try {
    await owner.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema},public`);
    pool = new Pool({ connectionString: scoped.toString() });
    await migrate(pool);
    await provision(pool, { role, password, schema });
    const hash = await bcrypt.hash(loginPassword, 4);
    await pool.query(
      'INSERT INTO users(organization_id,username,email,password_hash) VALUES($1,$2,$3,$4)',
      [
        DEFAULT_ORGANIZATION,
        'desktopfixture',
        'desktop@test.example.com',
        hash,
      ],
    );
    scoped.username = role;
    scoped.password = password;
    stage = 'backend configuration';
    const config = loadConfig({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3001',
      DATABASE_URL: scoped.toString(),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      JWT_REFRESH_SECRET: crypto.randomBytes(32).toString('hex'),
      VPN_REQUIRED: 'false',
      DEVICE_BINDING_ENABLED: 'false',
      RATE_LIMIT_MAX: '10000',
      AUTH_RATE_LIMIT_MAX: '1000',
      CORS_ORIGINS: 'http://tauri.localhost',
    });
    runtime = createRuntime({
      config,
      logger: { info() {}, warn() {}, error() {} },
      database,
    });
    const pages = express();
    pages.get('/fixture/page', (req, res) =>
      res.type('html').send(
        '<!doctype html><title>Policy test page</title><h1>Native browser acceptance</h1><a href="/fixture/second">Next checked page</a><p><a target="_blank" href="/fixture/second">Popup request</a></p><p><a href="/fixture/download">Download test</a></p><form action="/fixture/form" method="post"><input name="message" value="fixture-post"><button>Submit checked form</button></form>',
      ),
    );
    pages.get('/fixture/second', (req, res) =>
      res.type('html').send('<!doctype html><title>Second checked page</title><h1>Second page</h1>'),
    );
    pages.post('/fixture/form', express.urlencoded({ extended: false, limit: '1kb' }), (req, res) =>
      res.type('html').send(
        req.body.message === 'fixture-post'
          ? '<h1>POST body preserved</h1>'
          : '<h1>Invalid fixture form</h1>',
      ),
    );
    pages.get('/fixture/download', (req, res) =>
      res.attachment('fixture.txt').send('fixture download must be blocked'),
    );
    stage = 'backend listener';
    await runtime.start();
    stage = 'fixture page listener';
    pagesServer = pages.listen(3002, '127.0.0.1');
    await once(pagesServer, 'listening');
    stage = 'fixture activity';
    const stop = '.local-tests/desktop-stop';
    for (const file of [
      stop,
      '.local-tests/desktop-block',
      '.local-tests/desktop-revoke',
    ])
      if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.writeFileSync(
      '.local-tests/desktop-fixture.json',
      JSON.stringify({
        url: 'http://127.0.0.1:3001',
        page: 'http://127.0.0.1:3002/fixture/page',
        username: 'desktopfixture',
        password: loginPassword,
      }),
    );
    await new Promise((resolve) => {
      let busy = false;
      const timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          if (fs.existsSync('.local-tests/desktop-block')) {
            fs.unlinkSync('.local-tests/desktop-block');
            await pool.query(
              'INSERT INTO blocked_urls(organization_id,pattern) VALUES($1,$2) ON CONFLICT(organization_id,pattern) DO UPDATE SET is_active=TRUE',
              [DEFAULT_ORGANIZATION, '127.0.0.1'],
            );
          }
          if (fs.existsSync('.local-tests/desktop-revoke')) {
            fs.unlinkSync('.local-tests/desktop-revoke');
            await pool.query(
              'UPDATE sessions SET is_active=FALSE,refresh_hash=NULL',
            );
          }
          if (fs.existsSync(stop)) {
            clearInterval(timer);
            resolve();
          }
        } finally {
          busy = false;
        }
      }, 500);
    });
  } finally {
    if (pagesServer?.listening) {
      await new Promise((resolve) => pagesServer.close(resolve));
    }
    if (runtime) await runtime.stop();
    if (pool) await pool.end();
    try {
      await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await owner.query(`DROP ROLE IF EXISTS ${role}`);
    } finally {
      await owner.end();
    }
  }
})().catch((error) => {
  console.error('Desktop fixture failed', { code: error.code ?? 'UNEXPECTED', stage });
  process.exitCode = 1;
});
