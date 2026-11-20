'use strict';
const router=require('express').Router();
const { randomBytes,randomUUID }=require('node:crypto');
const { query,transaction }=require('../db/db');
const { tenantId }=require('../db/tenant');
const { Joi,validate,id,pagination,wrap,fail }=require('../services/validation');
const { change }=require('../services/governance-change');
const { lockDirectory,applyRoles,members }=require('../services/directory');
const { fingerprint }=require('../services/sso-settings');
const { hashToken }=require('../services/sessions');
const revision=Joi.number().integer().min(1).max(2147483646).required();
const superadmin=req=>{ if (req.user.role!=='superadmin') fail(403,'Superadmin access required','SUPERADMIN_REQUIRED'); };
const target=req=>validate(id.required(),req.params.id);
const publicDirectory=row=>({ id:row.id,name:row.name,providerId:row.provider_id,ssoLinking:row.sso_linking,isActive:row.is_active,revision:row.revision,createdAt:row.created_at });
function provider(req) {
  const row=req.app.locals.config.oidcProviders.find(p=>p.id===req.params.provider && p.organizationId===tenantId());
  if (!row) fail(404,'Configured provider not found');return row;
}
const lockProvider=p=>query('SELECT pg_advisory_xact_lock(hashtextextended($1,11))',[tenantId()+':'+p.id]);
router.get('/integrations/oidc',wrap(async(req,res)=>{
  const rows=(await query('SELECT * FROM oidc_settings')).rows;
  res.json({ providers:req.app.locals.config.oidcProviders.filter(p=>p.organizationId===tenantId()).map(p=>{
    const state=rows.find(row=>row.provider_id===p.id),matches=state?.configuration_hash===fingerprint(p);
    return { id:p.id,kind:p.kind || 'generic',issuer:p.issuer,clientId:p.clientId,redirectUri:p.redirectUri,
      provisioningSubjectClaim:p.provisioningSubjectClaim || 'none',mfaConfigured:!!(p.mfaAcrValues.length || p.mfaAmrValues.length),
      status:!state && !p.requireActivation ? 'legacy_enabled' : state?.enabled && matches ? 'enabled' : matches ? 'validated_disabled' : 'validation_required',
      enabled:state ? state.enabled && matches : !p.requireActivation,revision:state?.revision || 0,validatedAt:state?.validated_at || null };
  }) });
}));
router.post('/integrations/oidc/:provider/validate',wrap(async(req,res)=>{
  superadmin(req);const p=provider(req);let inspection;
  try { inspection=(await require('../services/oidc-client').createOidcClient(p)).inspect(); }
  catch { fail(503,'Configured provider discovery failed','OIDC_UNAVAILABLE'); }
  if (!Object.values(inspection.checks).every(Boolean)) fail(400,'Provider metadata does not meet the configured protocol requirements','OIDC_VALIDATION_FAILED');
  const state=await transaction(async()=>{
    await lockProvider(p);
    const hash=fingerprint(p);
    const row=(await query(`INSERT INTO oidc_settings(provider_id,configuration_hash,validated_at,enabled) VALUES($1,$2,NOW(),$3)
      ON CONFLICT(organization_id,provider_id) DO UPDATE SET configuration_hash=$2,validated_at=NOW(),
      enabled=oidc_settings.enabled AND oidc_settings.configuration_hash IS NOT DISTINCT FROM $2,revision=oidc_settings.revision+1 RETURNING revision,enabled`,[p.id,hash,!p.requireActivation])).rows[0];
    if (!row.enabled) await revokeProviderSessions(p.id);
    await change(req,'integration.oidc_validate',null,null,{ providerId:p.id,checks:inspection.checks,revision:row.revision });return row;
  });
  res.json({ ...state,checks:inspection.checks });
}));
router.put('/integrations/oidc/:provider/state',wrap(async(req,res)=>{
  superadmin(req);const p=provider(req),value=validate(Joi.object({ revision:Joi.number().integer().min(0).max(2147483646).required(),enabled:Joi.boolean().required() }),req.body);
  const state=await transaction(async()=>{
    await lockProvider(p);
    const old=(await query('SELECT * FROM oidc_settings WHERE provider_id=$1 FOR UPDATE',[p.id])).rows[0];
    if ((old?.revision || 0)!==value.revision) fail(409,'Provider revision conflict');
    if (value.enabled && (!old || old.configuration_hash!==fingerprint(p) || Date.now()-new Date(old.validated_at).getTime()>86400000)) fail(409,'Validate this configuration before activation','OIDC_VALIDATION_REQUIRED');
    const row=(await query(`INSERT INTO oidc_settings(provider_id,enabled) VALUES($1,$2)
      ON CONFLICT(organization_id,provider_id) DO UPDATE SET enabled=$2,revision=oidc_settings.revision+1 RETURNING revision,enabled`,[p.id,value.enabled])).rows[0];
    if (!value.enabled) await revokeProviderSessions(p.id);
    await change(req,'integration.oidc_state',null,{ providerId:p.id,enabled:old?.enabled ?? true },{ providerId:p.id,...row });return row;
  });res.json(state);
}));
async function revokeProviderSessions(providerId) {
  await query(`SELECT u.id FROM users u WHERE EXISTS(SELECT 1 FROM identity_links l WHERE l.user_id=u.id AND l.provider_id=$1)
    OR EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.oidc_provider_id=$1) ORDER BY u.id FOR UPDATE`,[providerId]);
  await query(`UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE authentication_method='oidc'
    AND (oidc_provider_id=$1 OR (oidc_provider_id IS NULL AND user_id IN(SELECT user_id FROM identity_links WHERE provider_id=$1)))`,[providerId]);
  await query('DELETE FROM oidc_console_grants WHERE provider_id=$1',[providerId]);
}
router.get('/integrations/directories',wrap(async(req,res)=>{
  const {limit,offset,page}=pagination(req);
  res.json({ directories:(await query('SELECT * FROM directory_connections ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',[limit,offset])).rows.map(publicDirectory),page,limit,
    scimEnabled:req.app.locals.config.SCIM_ENABLED,baseUrl:(req.app.locals.config.SCIM_PUBLIC_BASE_URL || '/scim/v2')+'/'+tenantId() });
}));
router.post('/integrations/directories',wrap(async(req,res)=>{
  superadmin(req);const value=validate(Joi.object({ name:Joi.string().min(1).max(160).required(),providerId:Joi.string().pattern(/^[a-z][a-z0-9-]{0,63}$/),ssoLinking:Joi.boolean().default(false) }),req.body);
  validateBinding(req,value.providerId,value.ssoLinking);
  const directory=await transaction(async()=>{
    const row=(await query('INSERT INTO directory_connections(name,provider_id,sso_linking) VALUES($1,$2,$3) RETURNING *',[value.name,value.providerId || null,value.ssoLinking])).rows[0];
    await change(req,'directory.create',row.id,null,publicDirectory(row));return publicDirectory(row);
  });res.status(201).json({ directory });
}));
function validateBinding(req,providerId,ssoLinking) {
  if (providerId && !req.app.locals.config.oidcProviders.some(p=>p.organizationId===tenantId() && p.id===providerId)) fail(400,'Provider must be configured for this organization');
  if (ssoLinking && !req.app.locals.config.oidcProviders.some(p=>p.organizationId===tenantId() && p.id===providerId && p.provisioningSubjectClaim && p.provisioningSubjectClaim!=='none')) fail(400,'Explicit operator subject binding is required','DIRECTORY_BINDING_REQUIRED');
}
router.patch('/integrations/directories/:id',wrap(async(req,res)=>{
  superadmin(req);const directoryId=target(req),value=validate(Joi.object({ revision,name:Joi.string().min(1).max(160).required(),isActive:Joi.boolean().required(),ssoLinking:Joi.boolean().required() }),req.body);
  const directory=await transaction(async()=>{
    const old=await lockDirectory(directoryId);
    if (old.revision!==value.revision) fail(409,'Directory revision conflict');
    validateBinding(req,old.provider_id,value.ssoLinking);
    const row=(await query('UPDATE directory_connections SET name=$2,is_active=$3,sso_linking=$4,revision=revision+1 WHERE id=$1 RETURNING *',[directoryId,value.name,value.isActive,value.ssoLinking])).rows[0];
    if (!value.isActive) {
      await query('UPDATE users SET is_active=FALSE,scim_version=scim_version+1,updated_at=NOW() WHERE directory_id=$1',[directoryId]);
      await query('UPDATE provisioning_credentials SET revoked_at=COALESCE(revoked_at,NOW()) WHERE directory_id=$1',[directoryId]);
    }
    if (!value.isActive || old.sso_linking!==value.ssoLinking) {
      await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id IN(SELECT id FROM users WHERE directory_id=$1)',[directoryId]);
      if (!value.ssoLinking) await query('DELETE FROM identity_links WHERE provider_id=$1 AND user_id IN(SELECT id FROM users WHERE directory_id=$2)',[old.provider_id,directoryId]);
    }
    await change(req,'directory.update',directoryId,publicDirectory(old),publicDirectory(row));return publicDirectory(row);
  });res.json({ directory });
}));
router.get('/integrations/directories/:id/credentials',wrap(async(req,res)=>{
  const directoryId=target(req);const {limit,offset,page}=pagination(req);
  if (!(await query('SELECT id FROM directory_connections WHERE id=$1',[directoryId])).rowCount) fail(404,'Directory not found');
  res.json({ credentials:(await query('SELECT id,created_by,created_at,expires_at,revoked_at,last_used_at FROM provisioning_credentials WHERE directory_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[directoryId,limit,offset])).rows,page,limit });
}));
router.post('/integrations/directories/:id/credentials',wrap(async(req,res)=>{
  superadmin(req);const directoryId=target(req),value=validate(Joi.object({ expiresInDays:Joi.number().integer().min(1).max(365).required() }),req.body);
  const credentialId=randomUUID(),token='rsx_scim.'+tenantId()+'.'+credentialId+'.'+randomBytes(32).toString('base64url');
  const credential=await transaction(async()=>{
    const directory=await lockDirectory(directoryId);if (!directory.is_active) fail(409,'Directory is disabled');
    const row=(await query(`INSERT INTO provisioning_credentials(id,directory_id,token_hash,created_by,expires_at)
      VALUES($1,$2,$3,$4,NOW()+($5::int*INTERVAL '1 day')) RETURNING id,expires_at`,[credentialId,directoryId,hashToken(token),req.user.sub,value.expiresInDays])).rows[0];
    await change(req,'directory.credential_create',credentialId,null,{ directoryId,expiresAt:row.expires_at });return row;
  });res.status(201).json({ credential,token });
}));
router.delete('/integrations/credentials/:id',wrap(async(req,res)=>{
  superadmin(req);const credentialId=target(req);
  await transaction(async()=>{
    const row=(await query('SELECT directory_id FROM provisioning_credentials WHERE id=$1',[credentialId])).rows[0];if (!row) fail(404,'Credential not found');
    await lockDirectory(row.directory_id);
    await query('UPDATE provisioning_credentials SET revoked_at=COALESCE(revoked_at,NOW()) WHERE id=$1',[credentialId]);
    await change(req,'directory.credential_revoke',credentialId,null,{ directoryId:row.directory_id });
  });res.json({ message:'Provisioning credential revoked' });
}));
router.get('/integrations/groups',wrap(async(req,res)=>{
  const {limit,offset,page}=pagination(req);const directoryId=req.query.directoryId===undefined ? null : validate(id,req.query.directoryId);
  res.json({ groups:(await query(`SELECT g.id,g.directory_id,g.display_name,g.external_id,g.mapped_role,g.revision,
    (SELECT COUNT(*)::int FROM directory_members m WHERE m.group_id=g.id) AS member_count
    FROM directory_groups g WHERE NOT is_deleted AND ($3::uuid IS NULL OR g.directory_id=$3) ORDER BY g.display_name,g.id LIMIT $1 OFFSET $2`,[limit,offset,directoryId])).rows,page,limit });
}));
router.patch('/integrations/groups/:id/mapping',wrap(async(req,res)=>{
  superadmin(req);const groupId=target(req),value=validate(Joi.object({ revision,role:Joi.string().valid('user','admin').required() }),req.body);
  const group=await transaction(async()=>{
    const old=(await query('SELECT * FROM directory_groups WHERE id=$1 AND NOT is_deleted',[groupId])).rows[0];if (!old) fail(404,'Group not found');
    const directory=await lockDirectory(old.directory_id);
    if (!directory.is_active) fail(409,'Directory is disabled');
    const locked=(await query('SELECT * FROM directory_groups WHERE id=$1 AND NOT is_deleted FOR UPDATE',[groupId])).rows[0];
    if (!locked) fail(404,'Group not found');if (locked.revision!==value.revision) fail(409,'Group revision conflict');
    const row=(await query('UPDATE directory_groups SET mapped_role=$2,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING id,mapped_role,revision',[groupId,value.role])).rows[0];
    await applyRoles(await members(groupId));
    await change(req,'directory.role_mapping',groupId,{ role:locked.mapped_role },{ role:value.role });return row;
  });res.json({ group });
}));
module.exports=router;
