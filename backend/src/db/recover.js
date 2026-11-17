'use strict';
const { randomUUID }=require('node:crypto');
async function invalidateRestoredSessions(pool,expectedDatabase) {
  if (!/^rsx_restore_[a-z0-9_]{1,40}$/.test(expectedDatabase || '')) throw new Error('A fresh restored database is required');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT current_database() AS name')).rows[0].name!==expectedDatabase) throw new Error('Recovery database differs from target');
    const rows=await client.query('SELECT id FROM organizations ORDER BY id');
    for (const row of rows.rows) {
      await client.query("SELECT set_config('app.organization_id',$1,true)",[row.id]);
      await client.query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE organization_id=$1',[row.id]);
      await client.query('UPDATE users SET is_locked=TRUE WHERE organization_id=$1',[row.id]);
      await client.query('UPDATE provisioning_credentials SET revoked_at=COALESCE(revoked_at,NOW()) WHERE organization_id=$1',[row.id]);
      await client.query('UPDATE directory_connections SET is_active=FALSE,revision=revision+1 WHERE organization_id=$1',[row.id]);
      await client.query('UPDATE oidc_settings SET enabled=FALSE,revision=revision+1 WHERE organization_id=$1',[row.id]);
      await client.query("UPDATE devices SET status='revoked',trust_state='revoked',posture_valid_until=NULL WHERE organization_id=$1",[row.id]);
      for (const table of ['oidc_transactions','oidc_console_grants','device_challenges']) await client.query(`DELETE FROM ${table} WHERE organization_id=$1`,[row.id]);
      await client.query("INSERT INTO audit_log(organization_id,actor_kind,action,request_id) VALUES($1,'operator','database.restore_revoke',$2)",[row.id,randomUUID()]);
    }
    await client.query('COMMIT');return rows.rowCount;
  } catch (error) { await client.query('ROLLBACK');throw error; }
  finally { client.release(); }
}
async function main() {
  require('../config').loadEnvironment();
  const config=require('./config').loadDatabaseConfig(),database=require('./db');
  database.configure(config,require('../logging').createLogger(config));
  try {
    if (process.argv[2]==='unlock') {
      const {validate,id,password}=require('../services/validation');
      const userId=validate(id.required(),process.argv[3]),organizationId=validate(id.required(),process.argv[4]);
      const content=require('node:fs').readFileSync(0,'utf8').replace(/\r?\n$/,'');
      const secret=validate(password.required(),content);
      const client=await database.getPool().connect();
      try {
        await client.query('BEGIN');
        const name=(await client.query('SELECT current_database() AS name')).rows[0].name;
        if (!/^rsx_restore_[a-z0-9_]{1,40}$/.test(name)) throw new Error('Restored database required');
        await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);
        const changed=await client.query(`UPDATE users SET is_locked=FALSE,password_auth_enabled=TRUE,password_hash=$3 WHERE id=$1 AND organization_id=$2
          AND role='superadmin' AND directory_id IS NULL AND is_active AND EXISTS(SELECT 1 FROM organizations WHERE id=$2 AND is_active) RETURNING id`,
          [userId,organizationId,await require('bcryptjs').hash(secret,12)]);
        if (changed.rowCount!==1) throw new Error('Active local superadmin required');
        await client.query("INSERT INTO audit_log(organization_id,actor_kind,action,target,request_id) VALUES($1,'operator','database.recovery_admin',$2,$3)",[organizationId,userId,randomUUID()]);
        await client.query('COMMIT');console.log('Verified recovery administrator unlocked');
      } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
    } else {
      await invalidateRestoredSessions(database.getPool(),process.env.RECOVERY_DATABASE);console.log('Restored sessions invalidated and accounts locked for reconciliation');
    }
  }
  finally { await database.close(); }
}
if (require.main===module) main().catch(()=>{console.error('Recovery verification or revocation failed');process.exitCode=1;});
module.exports={ invalidateRestoredSessions,main };
