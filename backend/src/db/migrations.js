'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
function readMigrations(directory = path.join(__dirname, 'migrations')) {
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  const prefixes = new Set();
  return names.map(version => {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(version) || prefixes.has(version.slice(0, 3))) throw new Error('Invalid or duplicate migration version');
    prefixes.add(version.slice(0, 3));
    const sql = fs.readFileSync(path.join(directory, version), 'utf8').replace(/\r\n/g, '\n');
    return { version, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}
function validateApplied(rows, migrations) {
  const byVersion = new Map(migrations.map(m => [m.version, m]));
  for (const row of rows) if (!byVersion.has(row.version) || byVersion.get(row.version).checksum !== row.checksum) throw new Error('Database migration history differs from this build');
  if (rows.map(r => r.version).sort().some((version, i) => migrations[i]?.version !== version)) throw new Error('Database migration history is out of order');
}
async function migrate(pool, migrations = readMigrations()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query('SELECT pg_advisory_xact_lock(77002, 1)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const { rows } = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
    validateApplied(rows, migrations);
    const applied = new Set(rows.map(r => r.version)); const executed = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [migration.version, migration.checksum]);
      executed.push(migration.version);
    }
    await client.query('COMMIT'); return executed;
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
async function verifyMigrations(pool, migrations = readMigrations()) {
  const { rows } = await pool.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  validateApplied(rows, migrations);
  if (rows.length !== migrations.length) throw new Error('Database migrations pending; run npm run migrate');
}
module.exports = { migrate, verifyMigrations, readMigrations, validateApplied };
