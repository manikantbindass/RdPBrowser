'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err);
});

/**
 * Initialize DB — run schema.sql on first boot
 */
async function initDB() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query(schema);
  } finally {
    client.release();
  }
}

/**
 * Execute a parameterised query
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn(`Slow query (${duration}ms): ${text}`);
  }
  return res;
}

/**
 * Get a client for transactions
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, initDB, pool };
