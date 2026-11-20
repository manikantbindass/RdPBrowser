'use strict';
async function main() {
  const { loadEnvironment }=require('./config');loadEnvironment();
  if (!process.env.MIGRATION_DATABASE_URL && !process.env.MIGRATION_DATABASE_URL_FILE) throw new Error('Operator migration credentials required');
  const config=require('./db/config').loadDatabaseConfig();
  const database=require('./db/db');database.configure(config,require('./logging').createLogger(config));
  try {
    const { verifyMigrations }=require('./db/migrations');await verifyMigrations(database.getPool());
    const lifecycle=require('./services/organization-lifecycle');
    const action=process.argv[2];let result;
    if (action==='onboard') result=await lifecycle.onboard(database.getPool(),{ organizationId:process.env.ORGANIZATION_ID,name:process.env.ORGANIZATION_NAME,
      username:process.env.BOOTSTRAP_ADMIN_USERNAME,email:process.env.BOOTSTRAP_ADMIN_EMAIL,password:process.env.BOOTSTRAP_ADMIN_PASSWORD });
    else if (action==='offboard' && process.env.CONFIRM_ORGANIZATION_OFFBOARD===process.env.ORGANIZATION_ID && process.env.ORGANIZATION_ID)
      result=await lifecycle.offboard(database.getPool(),process.env.ORGANIZATION_ID);
    else throw new Error('Select onboard or confirmed offboard');
    console.log(JSON.stringify(result));
  } finally { await database.close(); }
}
if (require.main===module) main().catch(()=>{ console.error('Organization operation failed; inspect private operator configuration and database state. No credentials logged.');process.exitCode=1; });
module.exports={ main };
