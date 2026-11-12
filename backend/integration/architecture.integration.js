'use strict';
const { Pool } = require('pg');
const { randomUUID, createHash } = require('crypto');
const request = require('supertest');
const { io: connectSocket } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { provision } = require('../src/db/provision');
const { DEFAULT_ORGANIZATION } = require('../src/db/tenant');
const { migrate, verifyMigrations, readMigrations } = require('../src/db/migrations');
const { createRuntime } = require('../src/runtime');
const database = require('../src/db/db');
const { loadConfig } = require('../src/config');

// Explicit disposable test database only; never infer a production target.
const url = process.env.INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Set INTEGRATION_DATABASE_URL to a dedicated database whose name ends in _test');
const schema = `phase02_${randomUUID().replace(/-/g, '')}`;
const role=`test_${randomUUID().replace(/-/g,'')}`;
const password=randomUUID()+randomUUID();
const adminPool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
let pool;
let runtime;
let adminToken;
const scopedUrl = new URL(url);
scopedUrl.searchParams.set('options', `-c search_path=${schema},public`);
scopedUrl.username=role; scopedUrl.password=password;
const config = { ...loadConfig({ NODE_ENV: 'test', DATABASE_URL: scopedUrl.toString(), JWT_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64), VPN_REQUIRED: 'false' }), PORT: 0 };
const logger = { info() {}, warn() {}, error() {} };

beforeAll(async () => {
  await adminPool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
  await adminPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
});
afterAll(async () => {
  if (runtime) await runtime.stop();
  if (pool) await pool.end();
  try { await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await adminPool.query(`DROP ROLE IF EXISTS ${role}`); }
  finally { await adminPool.end(); }
});

test('baseline migration preserves legacy rows, records checksums and is repeatable under concurrency', async () => {
  await pool.query(readMigrations()[0].sql); // Existing unversioned installation.
  const hash = await bcrypt.hash('TestPassword1!', 4);
  const { rows } = await pool.query("INSERT INTO users(username,email,password_hash,role) VALUES ('phaseadmin','admin@test.invalid',$1,'admin') RETURNING id", [hash]);
  const results = await Promise.all([migrate(pool), migrate(pool)]);
  expect(results.flat()).toEqual(readMigrations().map(m => m.version));
  await provision(pool,{ role,password,schema });
  expect((await pool.query('SELECT username FROM users WHERE id=$1', [rows[0].id])).rows[0].username).toBe('phaseadmin');
  await verifyMigrations(pool);
  adminToken = jwt.sign({ sub: rows[0].id, role: 'admin' }, config.JWT_SECRET, { expiresIn: '1h' });
  await pool.query("INSERT INTO sessions(organization_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '1 hour')", [DEFAULT_ORGANIZATION,rows[0].id, createHash('sha256').update(adminToken).digest('hex')]);
});
test('failed migration rolls back DDL and history and rejects checksum edits', async () => {
  const migrations = readMigrations();
  await expect(migrate(pool, [...migrations, { version: '003_failure.sql', checksum: 'bad', sql: 'CREATE TABLE rollback_probe(id INT); SELECT nonexistent_column;' }])).rejects.toThrow();
  expect((await pool.query("SELECT to_regclass('rollback_probe') AS table_name")).rows[0].table_name).toBeNull();
  expect((await pool.query('SELECT COUNT(*) FROM schema_migrations')).rows[0].count).toBe(String(migrations.length));
  await expect(migrate(pool, [{ ...migrations[0], checksum: 'edited' }])).rejects.toThrow('history differs');
});
test('runtime, legacy/versioned auth, SQL filtering and readiness use real PostgreSQL', async () => {
  // Connection URL options scope every actual pg connection to the owned schema.
  runtime = createRuntime({ config, logger, database });
  await runtime.start();
  expect((await request(runtime.app).get('/ready')).status).toBe(200);
  const minted = [];
  for (const path of ['/api/auth/login', '/api/v1/auth/login']) {
    const login = await request(runtime.app).post(path).send({ username: 'phaseadmin', password: 'TestPassword1!' });
    expect(login.status).toBe(200);
    minted.push(login.body.accessToken);
    const stats = await request(runtime.app).get('/api/v1/admin/ip-logs?flagged=true').auth(login.body.accessToken, { type: 'bearer' });
    expect(stats.status).toBe(200); expect(stats.body.logs).toEqual([]);
  }
  expect(minted[0]).not.toBe(minted[1]);
});
test('realtime rejects missing/revoked tokens and accepts a live admin session', async () => {
  // Login revokes the original token under the existing one-session policy.
  const socketUrl = `http://127.0.0.1:${runtime.server.address().port}`;
  async function rejected(token) {
    const socket = connectSocket(socketUrl, { auth: { token }, reconnection: false });
    try { return await new Promise(resolve => socket.once('connect_error', error => resolve(error.message))); }
    finally { socket.disconnect(); }
  }
  expect(await rejected(undefined)).toBe('Socket authentication failed');
  expect(await rejected(adminToken)).toBe('Socket authentication failed');
  const login = await request(runtime.app).post('/api/v1/auth/login').send({ username: 'phaseadmin', password: 'TestPassword1!' });
  const socket = connectSocket(socketUrl, { auth: { token: login.body.accessToken }, reconnection: false });
  try {
    const snapshot = await new Promise((resolve, reject) => {
      socket.once('connect_error', reject);
      socket.once('connect', () => socket.emit('join_admin', login.body.accessToken));
      socket.once('sessions_snapshot', resolve);
    });
    expect(snapshot).toEqual([]); // Legacy snapshot map is not claimed to be a live DB inventory.
  } finally { socket.disconnect(); }
});
