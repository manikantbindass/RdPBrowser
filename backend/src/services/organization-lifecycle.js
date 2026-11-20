'use strict';
const { randomUUID }=require('node:crypto');
const bcrypt=require('bcryptjs');
const { Joi,validate,id,password,fail }=require('./validation');
// Operator-only entry point. Never import from an HTTP route.
async function onboard(pool,input) {
  const value=validate(Joi.object({ organizationId:id.required(),name:Joi.string().min(1).max(160).required(),
    username:Joi.string().alphanum().min(3).max(80).required(),email:Joi.string().email({ tlds:{ allow:false } }).max(255).required(),password:password.required() }),input);
  const hash=await bcrypt.hash(value.password,12),client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[value.organizationId]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,12))',[value.organizationId]);
    if ((await client.query('SELECT id FROM organizations WHERE id=$1',[value.organizationId])).rowCount) fail(409,'Organization already exists; no changes made');
    await client.query('INSERT INTO organizations(id,name,onboarded_at) VALUES($1,$2,NOW())',[value.organizationId,value.name]);
    const user=(await client.query("INSERT INTO users(organization_id,username,email,password_hash,role) VALUES($1,$2,$3,$4,'superadmin') RETURNING id",[value.organizationId,value.username,value.email.toLowerCase(),hash])).rows[0];
    await client.query("INSERT INTO audit_log(organization_id,actor_kind,action,target,request_id) VALUES($1::uuid,'operator','organization.onboard',$1::uuid::text,$2)",[value.organizationId,randomUUID()]);
    await client.query('COMMIT');return { organizationId:value.organizationId,bootstrapAdministratorId:user.id,status:'active',ssoConfigured:false };
  } catch(err) { await client.query('ROLLBACK');throw err; } finally { client.release(); }
}
async function offboard(pool,organizationId) {
  validate(id.required(),organizationId);const client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,12))',[organizationId]);
    const org=(await client.query('SELECT * FROM organizations WHERE id=$1 FOR NO KEY UPDATE',[organizationId])).rows[0];if (!org) fail(404,'Organization not found');
    // Owner credentials can bypass RLS: every statement must scope explicitly.
    await client.query('SELECT id FROM directory_connections WHERE organization_id=$1 ORDER BY id FOR UPDATE',[organizationId]);
    const devices=await client.query('SELECT id FROM devices WHERE organization_id=$1 ORDER BY id LIMIT 10001',[organizationId]);
    if (devices.rowCount>10000) fail(503,'Offboarding requires a reviewed batch plan above 10000 devices');
    if (!org.offboarded_at) {
      await client.query('UPDATE organizations SET is_active=FALSE,offboarded_at=NOW() WHERE id=$1',[organizationId]);
      await client.query('UPDATE users SET is_active=FALSE,scim_version=scim_version+1,updated_at=NOW() WHERE organization_id=$1',[organizationId]);
      await client.query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE organization_id=$1',[organizationId]);
      await client.query("UPDATE devices SET status='revoked',trust_state='revoked',posture_valid_until=NULL WHERE organization_id=$1",[organizationId]);
      await client.query('UPDATE directory_connections SET is_active=FALSE,revision=revision+1 WHERE organization_id=$1',[organizationId]);
      await client.query('UPDATE provisioning_credentials SET revoked_at=COALESCE(revoked_at,NOW()) WHERE organization_id=$1',[organizationId]);
      await client.query('UPDATE oidc_settings SET enabled=FALSE,revision=revision+1 WHERE organization_id=$1',[organizationId]);
      await client.query('DELETE FROM oidc_transactions WHERE organization_id=$1',[organizationId]);
      await client.query('DELETE FROM oidc_console_grants WHERE organization_id=$1',[organizationId]);
      await client.query("INSERT INTO audit_log(organization_id,actor_kind,action,target,request_id) VALUES($1::uuid,'operator','organization.offboard',$1::uuid::text,$2)",[organizationId,randomUUID()]);
    }
    await client.query('COMMIT');return { organizationId,status:'offboarded',applicationAccessRevoked:true,
      gatewayPeerRevocationRequired:true,deviceIds:devices.rows.map(row=>row.id),dataDeleted:false };
  } catch(err) { await client.query('ROLLBACK');throw err; } finally { client.release(); }
}
module.exports={ onboard,offboard };
