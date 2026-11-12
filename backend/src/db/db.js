'use strict';
const { Pool } = require('pg');
const fs = require('fs');
const { verifyMigrations } = require('./migrations');
const { AsyncLocalStorage } = require('async_hooks');
const { tenantId } = require('./tenant');
const transactions = new AsyncLocalStorage();
let config;
let logger;
let pool;
function configure(nextConfig, nextLogger) {
  if (pool && config !== nextConfig) throw new Error('Database already initialized');
  config = nextConfig; logger = nextLogger;
}
function getPool() {
  if (!config) throw new Error('Database is not configured');
  if (!pool) {
    pool = new Pool({ connectionString: config.DATABASE_URL,
      ssl: config.DB_SSL_MODE === 'verify-full' ? { rejectUnauthorized: true, ...(config.DB_SSL_CA_FILE ? { ca: fs.readFileSync(config.DB_SSL_CA_FILE, 'utf8') } : {}) } : false,
      max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 2000, statement_timeout: 15000 });
    pool.on('error', () => logger?.error({ event: 'database.pool_error' }));
  }
  return pool;
}
async function transaction(fn) {
  const organizationId = tenantId();
  const existing = transactions.getStore();
  if (existing) {
    if (existing.organizationId !== organizationId) throw new Error('Transaction tenant cannot change');
    return fn(existing.client);
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
    const result = await transactions.run({ client, organizationId }, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
async function query(text, params) { return transaction(client => client.query(text, params)); }
async function getClient() { return getPool().connect(); }
async function assertRuntimeRole(pool) {
  const { rows } = await pool.query('SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user');
  if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) throw new Error('Runtime database role must not bypass row-level security');
  if (rows[0]?.rolcreaterole || rows[0]?.rolcreatedb) throw new Error('Runtime role must not administer roles/databases');
  const memberships=await pool.query('SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user) LIMIT 1');
  if (memberships.rows.length) throw new Error('Runtime role must not assume other roles');
  const owned=await pool.query("SELECT 1 FROM pg_tables WHERE schemaname=current_schema() AND tableowner=current_user LIMIT 1");
  if (owned.rows.length) throw new Error('Runtime role must not own application tables');
}
async function checkReady() { const pool=getPool(); await assertRuntimeRole(pool); await verifyMigrations(pool); }
async function initDB() { await checkReady(); }
async function close() { if (pool) { const previous = pool; pool = undefined; await previous.end(); } }
module.exports = { query, transaction, getClient, initDB, checkReady, assertRuntimeRole, configure, getPool, close };
