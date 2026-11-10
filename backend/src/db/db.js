'use strict';
const { Pool } = require('pg');
const fs = require('fs');
const { verifyMigrations } = require('./migrations');
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
async function query(text, params) { return getPool().query(text, params); }
async function getClient() { return getPool().connect(); }
async function checkReady() { await query('SELECT 1'); await verifyMigrations(getPool()); }
async function initDB() { await checkReady(); }
async function close() { if (pool) { const previous = pool; pool = undefined; await previous.end(); } }
module.exports = { query, getClient, initDB, checkReady, configure, getPool, close };
