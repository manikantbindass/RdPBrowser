'use strict';
const router=require('express').Router();
const crypto=require('crypto');
const { query,transaction }=require('../db/db');
const { tenantId }=require('../db/tenant');
const { Joi,validate,id,wrap,fail,pagination }=require('../services/validation');
const { policySchema,loadPolicy,resources,decide,recordDecision }=require('../services/access');
const { authenticateToken }=require('../middleware/auth');
const { audit }=require('../services/audit');
const { hashToken }=require('../services/sessions');
router.use((req,res,next) => {
  if (!/^\/(access(?:\/|$)|devices\/[^/]+\/(?:key|challenge|proof)$|admin\/(?:access-policy|identity-links|access-decisions|devices)(?:\/|$))/.test(req.path)) return next('router');
  if (req.accessContext) return next();
  return authenticateToken(req,res,next);
});
function admin(req) { if (!['admin','superadmin'].includes(req.user.role)) fail(403,'Admin access required'); }
function found(result) { if (!result.rows.length) fail(404,'Resource not found'); return result.rows[0]; }
const target=req => validate(id.required(),req.params.id);
async function ownedDevice(req,deviceId,lock=false) {
  return found(await query(`SELECT * FROM devices WHERE id=$1 AND organization_id=$2 AND user_id=$3 ${lock ? 'FOR UPDATE' : ''}`,[deviceId,tenantId(),req.user.sub]));
}
router.get('/admin/access-policy',wrap(async (req,res) => { admin(req);res.json(await loadPolicy()); }));
router.put('/admin/access-policy',wrap(async (req,res) => {
  admin(req); const value=validate(Joi.object({ revision:Joi.number().integer().min(0).max(2147483646).required(),configuration:policySchema.required() }),req.body);
  const result=await transaction(async () => {
    await query('SELECT pg_advisory_xact_lock(hashtext($1),5)',[tenantId()]);
    const old=await loadPolicy();
    if (old.revision!==value.revision) fail(409,'Access policy revision conflict');
    if (!value.configuration.allowedRoles.some(r => ['admin','superadmin'].includes(r))) fail(400,'Policy must retain an administrative role');
    if (value.configuration.requireMfa || value.configuration.highSensitivityRequireMfa || !value.configuration.allowedAuthMethods.includes('password')) {
      const providers=req.app.locals.config.oidcProviders.filter(p => p.organizationId===tenantId() && (p.mfaAcrValues.length || p.mfaAmrValues.length));
      const links=await query('SELECT provider_id FROM identity_links l JOIN users u ON u.id=l.user_id WHERE u.role IN (\'admin\',\'superadmin\') AND u.is_active AND NOT u.is_locked');
      if (!providers.some(p => links.rows.some(l => l.provider_id===p.id))) fail(400,'Configure and link an MFA-capable administrator provider before enforcement');
    }
    const activation=decide({ ...req.accessContext,policy:value.configuration,resource:'admin.manage' });
    if (!activation.allowed) fail(400,'Authenticate the current administrator under the proposed policy before activation','POLICY_ACTIVATION_DENIED');
    const row=found(await query(`INSERT INTO access_policies(configuration,revision) VALUES($1,1) ON CONFLICT(organization_id)
      DO UPDATE SET configuration=$1,revision=access_policies.revision+1,updated_at=NOW() RETURNING revision,configuration`,[value.configuration]));
    await audit(req,'access_policy.update',null); return row;
  });
  res.json(result);
}));
router.post('/admin/identity-links',wrap(async (req,res) => {
  admin(req);const value=validate(Joi.object({ userId:id.required(),providerId:Joi.string().max(64).required(),subject:Joi.string().min(1).max(255).required() }),req.body);
  const provider=req.app.locals.config.oidcProviders.find(p => p.id===value.providerId && p.organizationId===tenantId());
  if (!provider) fail(400,'Provider is not configured for this organization');
  const row=await transaction(async () => {
    found(await query('SELECT id FROM users WHERE id=$1',[value.userId]));
    const link=found(await query('INSERT INTO identity_links(user_id,provider_id,issuer,subject) VALUES($1,$2,$3,$4) RETURNING id,user_id,provider_id',[value.userId,provider.id,provider.issuer,value.subject]));
    await audit(req,'identity.link',link.id);return link;
  });
  res.status(201).json({ link:row });
}));
router.delete('/admin/identity-links/:id',wrap(async (req,res) => {
  admin(req);const linkId=target(req);
  await transaction(async () => {
    const link=found(await query('SELECT user_id FROM identity_links WHERE id=$1',[linkId]));
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[link.user_id]);
    await query('DELETE FROM identity_links WHERE id=$1',[linkId]);
    await query("UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1 AND authentication_method='oidc'",[link.user_id]);
    await audit(req,'identity.unlink',linkId);
  });res.json({ message:'Identity link and enterprise sessions revoked' });
}));
router.post('/devices/:id/key',wrap(async (req,res) => {
  const deviceId=target(req);
  const value=validate(Joi.object({ publicKey:Joi.object({ kty:Joi.string().valid('EC').required(),crv:Joi.string().valid('P-256').required(),
    x:Joi.string().pattern(/^[A-Za-z0-9_-]{43}$/).required(),y:Joi.string().pattern(/^[A-Za-z0-9_-]{43}$/).required() }).required() }),req.body);
  try { crypto.createPublicKey({ key:value.publicKey,format:'jwk' }); } catch { fail(400,'Invalid device public key'); }
  await transaction(async () => {
    const device=await ownedDevice(req,deviceId,true);
    if (device.public_key || device.status==='revoked' || device.trust_state!=='unknown') fail(409,'Device key is immutable; register a new device');
    await query('UPDATE devices SET public_key=$1 WHERE id=$2',[value.publicKey,deviceId]);
    await audit(req,'device.key_enroll',deviceId);
  });res.status(201).json({ message:'Public key enrolled; device remains untrusted' });
}));
router.post('/devices/:id/challenge',wrap(async (req,res) => {
  const deviceId=target(req),device=await ownedDevice(req,deviceId);
  if (!device.public_key || device.status==='revoked' || ['revoked','quarantined'].includes(device.trust_state)) fail(403,'Device cannot prove possession');
  const nonce=crypto.randomBytes(32).toString('base64url'),challengeId=crypto.randomUUID();
  await transaction(async () => {
    await query('DELETE FROM device_challenges WHERE expires_at<NOW() OR (user_id=$1 AND session_id=$2)',[req.user.sub,req.sessionId]);
    await query(`INSERT INTO device_challenges(id,user_id,session_id,device_id,nonce_hash,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '5 minutes')`,[challengeId,req.user.sub,req.sessionId,deviceId,hashToken(nonce)]);
  });res.status(201).json({ challengeId,nonce,message:`RemoteShieldX.device.v1:${challengeId}:${nonce}:${req.sessionId}`,algorithm:'ECDSA-SHA256-DER',expiresIn:300 });
}));
router.post('/devices/:id/proof',wrap(async (req,res) => {
  const deviceId=target(req);
  const value=validate(Joi.object({ challengeId:id.required(),nonce:Joi.string().pattern(/^[A-Za-z0-9_-]{43}$/).required(),signature:Joi.string().pattern(/^[A-Za-z0-9_-]{80,120}$/).required() }),req.body);
  const result=await transaction(async () => {
    const device=await ownedDevice(req,deviceId,true);
    const challenge=(await query(`DELETE FROM device_challenges WHERE id=$1 AND device_id=$2 AND session_id=$3 AND user_id=$4 AND expires_at>NOW() RETURNING nonce_hash`,[value.challengeId,deviceId,req.sessionId,req.user.sub])).rows[0];
    let valid=false;
    try { valid=!!challenge && challenge.nonce_hash===hashToken(value.nonce) && !!device.public_key && device.status!=='revoked' && !['revoked','quarantined'].includes(device.trust_state) &&
      crypto.verify('sha256',Buffer.from(`RemoteShieldX.device.v1:${value.challengeId}:${value.nonce}:${req.sessionId}`),crypto.createPublicKey({ key:device.public_key,format:'jwk' }),Buffer.from(value.signature,'base64url')); } catch { valid=false; }
    if (valid) await query('UPDATE sessions SET registered_device_id=$1,device_proved_at=NOW() WHERE id=$2 AND user_id=$3 AND is_active',[deviceId,req.sessionId,req.user.sub]);
    await audit(req,valid ? 'device.proof_allow' : 'device.proof_deny',deviceId);
    return valid;
  });
  if (!result) fail(403,'Device possession proof rejected','DEVICE_PROOF_REJECTED');
  res.json({ message:'Device key possession verified; posture still requires administrator approval' });
}));
router.patch('/admin/devices/:id/trust',wrap(async (req,res) => {
  admin(req);const deviceId=target(req);
  const value=validate(Joi.object({ trustState:Joi.string().valid('unknown','approved','quarantined','revoked').required(),
    validForSeconds:Joi.number().integer().min(60).max(86400),reason:Joi.string().valid('operator_verified','noncompliant','compromised','review_required').required() }),req.body);
  if (value.trustState==='approved' && !value.validForSeconds) fail(400,'Approved posture requires a bounded validity');
  await transaction(async () => {
    const device=found(await query('SELECT * FROM devices WHERE id=$1 FOR UPDATE',[deviceId]));
    if (device.trust_state==='revoked' || device.status==='revoked') fail(409,'Revoked devices cannot be restored');
    if (value.trustState==='approved' && !device.public_key) fail(400,'Enroll a device key before approval');
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[device.user_id]);
    await query(`UPDATE devices SET trust_state=$1,status=CASE WHEN $1='revoked' THEN 'revoked' ELSE status END,
      posture_valid_until=CASE WHEN $1='approved' THEN NOW()+($2*INTERVAL '1 second') ELSE NULL END WHERE id=$3`,[value.trustState,value.validForSeconds || 0,deviceId]);
    if (['quarantined','revoked'].includes(value.trustState)) await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE registered_device_id=$1 OR (user_id=$2 AND device_id=$3)',[deviceId,device.user_id,device.external_id]);
    await audit(req,'device.trust_'+value.trustState,deviceId);
  });res.json({ message:'Device trust updated' });
}));
router.post('/access/evaluate',wrap(async (req,res) => {
  const value=validate(Joi.object({ resource:Joi.string().valid(...Object.keys(resources)).required() }),req.body);
  const context=req.accessContext;
  const decision=decide({ ...context,resource:value.resource,policy:context.policy.configuration });
  await recordDecision(req,context.user,context.session,context.device,decision,context.policy.revision);
  res.json({ ...decision,policyRevision:context.policy.revision,enforcement:'server-resource-gates' });
}));
router.get('/admin/access-decisions',wrap(async (req,res) => {
  admin(req);const { limit,offset,page }=pagination(req);
  const result=await query('SELECT id,user_id,session_id,device_id,resource,sensitivity,outcome,reason,request_id,policy_revision,created_at FROM access_decisions ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',[limit,offset]);
  res.json({ decisions:result.rows,page,limit });
}));
module.exports=router;
