'use strict';
const { loadEnvironment, loadConfig } = require('../config');
const { createLogger } = require('../logging');
const database = require('./db');
const { migrate } = require('./migrations');
async function main() {
  loadEnvironment(); const config = loadConfig({ ...process.env, DATABASE_URL:process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL }); const logger = createLogger(config);
  database.configure(config, logger);
  try {
    logger.info({ event: 'migrations.applied', versions: await migrate(database.getPool()) });
    if (process.env.DB_RUNTIME_PASSWORD) await require('./provision').provision(database.getPool(),{ password:process.env.DB_RUNTIME_PASSWORD });
  }
  finally { await database.close(); }
}
if (require.main === module) main().catch(err => { console.error(JSON.stringify({ event: 'migrations.failed', code: err.code || 'MIGRATION_FAILED', message: 'Inspect database/schema state; no credentials logged' })); process.exitCode = 1; });
module.exports = { main };
