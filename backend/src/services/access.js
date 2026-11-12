'use strict';
const { randomUUID }=require('crypto');
const { query }=require('../db/db');
const { tenantId }=require('../db/tenant');
const { Joi }=require('./validation');
const defaults=Object.freeze({ allowedRoles:['user','admin','superadmin'],allowedAuthMethods:['password','oidc'],requireMfa:false,
  highSensitivityRequireMfa:false,requireTrustedDevice:false,sessionMaxAgeSeconds:604800,idleTimeoutSeconds:86400,
  maxProofAgeSeconds:900,maxMfaAgeSeconds:3600 });
const policySchema=Joi.object({
  allowedRoles:Joi.array().items(Joi.string().valid('user','admin','superadmin')).min(1).unique().required(),
  allowedAuthMethods:Joi.array().items(Joi.string().valid('password','oidc')).min(1).unique().required(),
  requireMfa:Joi.boolean().required(),highSensitivityRequireMfa:Joi.boolean().required(),requireTrustedDevice:Joi.boolean().required(),
  sessionMaxAgeSeconds:Joi.number().integer().min(300).max(604800).required(),idleTimeoutSeconds:Joi.number().integer().min(60).max(86400).required(),
  maxProofAgeSeconds:Joi.number().integer().min(60).max(86400).required(),maxMfaAgeSeconds:Joi.number().integer().min(60).max(86400).required(),
});
const resources=Object.freeze({ 'auth.login':'low','session.terminate':'low','device.enroll':'low','session.manage':'medium',
  'browser.navigate':'medium','events.ingest':'low','admin.manage':'high','realtime.connect':'low' });
function resourceFor(req) {
  if (req.accessResource) return req.accessResource;
  const path=(req.baseUrl || '')+(req.path || '');
  if (/\/auth\/logout$/.test(path)) return 'session.terminate';
  if (/\/policies\/evaluate$/.test(path)) return 'browser.navigate';
  if (/\/(admin)(\/|$)/.test(path) || (req.method!=='GET' && /\/(users|policies)(\/|$)/.test(path))) return 'admin.manage';
  if (/\/devices(\/|$)/.test(path)) return req.method==='POST' ? 'device.enroll' : 'session.manage';
  if (/\/events(\/|$)/.test(path)) return req.method==='GET' ? 'admin.manage' : 'events.ingest';
  if (/\/proxy(\/|$)/.test(path)) return 'browser.navigate';
  return 'session.manage';
}
async function loadPolicy() {
  const row=(await query('SELECT revision,configuration FROM access_policies WHERE organization_id=$1',[tenantId()])).rows[0];
  if (!row) return { revision:0,configuration:defaults };
  // Database/operator edits are untrusted too. Invalid policy fails closed.
  const { error,value }=policySchema.validate(row.configuration,{ convert:false });
  if (error) throw Object.assign(new Error('Access policy invalid'),{ status:503,code:'POLICY_UNAVAILABLE' });
  return { revision:row.revision,configuration:value };
}
function decide({ user,session,device,resource,policy,now=Date.now(),login=false }) {
  const sensitivity=resources[resource];
  const deny=reason => ({ allowed:false,reason,resource,sensitivity:sensitivity || 'high' });
  if (!sensitivity) return deny('RESOURCE_UNKNOWN');
  if (!user?.is_active || user.is_locked || !user.organization_active) return deny('IDENTITY_INACTIVE');
  if (user.organization_id!==session?.organization_id) return deny('ORGANIZATION_MISMATCH');
  if (!session?.is_active) return deny('SESSION_REVOKED');
  const expired=value => !value || new Date(value).getTime()<=now;
  if (expired(session.absolute_expires_at) || now-new Date(session.authenticated_at).getTime()>policy.sessionMaxAgeSeconds*1000) return deny('SESSION_ABSOLUTE_EXPIRED');
  if (now-new Date(session.last_activity).getTime()>policy.idleTimeoutSeconds*1000) return deny('SESSION_IDLE_EXPIRED');
  if (!policy.allowedRoles.includes(user.role)) return deny('ROLE_DENIED');
  if (resource==='admin.manage' && !['admin','superadmin'].includes(user.role)) return deny('ADMIN_REQUIRED');
  // A live session may always terminate itself, even after policy tightening.
  if (resource==='session.terminate') return { allowed:true,reason:'SELF_TERMINATION',resource,sensitivity };
  if (!policy.allowedAuthMethods.includes(session.authentication_method)) return deny('AUTH_METHOD_DENIED');
  if ((policy.requireMfa || (sensitivity==='high' && policy.highSensitivityRequireMfa)) &&
      (!session.mfa_verified || session.authentication_method!=='oidc' || now-new Date(session.authenticated_at).getTime()>policy.maxMfaAgeSeconds*1000)) return deny('MFA_REQUIRED');
  if (device && (device.user_id!==user.id || device.organization_id!==user.organization_id)) return deny('DEVICE_OWNER_MISMATCH');
  if (device && (device.status==='revoked' || ['revoked','quarantined'].includes(device.trust_state))) return deny('DEVICE_INVALID');
  // Login can create a restricted session to perform possession proof. Other resources still fail closed.
  if (policy.requireTrustedDevice && !login && resource!=='device.enroll' &&
      (!device || device.trust_state!=='approved' || !device.public_key || expired(device.posture_valid_until) || !session.device_proved_at ||
        now-new Date(session.device_proved_at).getTime()>policy.maxProofAgeSeconds*1000)) return deny('TRUSTED_DEVICE_REQUIRED');
  return { allowed:true,reason:'POLICY_ALLOWED',resource,sensitivity };
}
async function recordDecision(req,user,session,device,decision,revision) {
  const requestId=req.requestId || randomUUID();
  await query(`INSERT INTO access_decisions(user_id,session_id,device_id,resource,sensitivity,outcome,reason,request_id,policy_revision)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[user.id,session?.id || null,device?.id || null,decision.resource,decision.sensitivity,
    decision.allowed ? 'allow' : 'deny',decision.reason,requestId,revision]);
  req.app?.get?.('logger')?.info({ event:'access.decision',requestId,organizationId:tenantId(),userId:user.id,
    resource:decision.resource,outcome:decision.allowed ? 'allow' : 'deny',reason:decision.reason,policyRevision:revision });
}
module.exports={ defaults,policySchema,resources,resourceFor,loadPolicy,decide,recordDecision };
