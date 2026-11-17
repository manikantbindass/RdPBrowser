'use strict';
async function main() {
  const { loadConfig,loadEnvironment } = require('./config');loadEnvironment();
  const config=loadConfig();
  const database=require('./db/db');database.configure(config,require('./logging').createLogger(config));
  try { await database.checkReady();console.log('Database role and migration checks passed'); }
  finally { await database.close(); }
}
if (require.main===module) main().catch(()=>{console.error('Database compatibility check failed');process.exitCode=1;});
module.exports={ main };
