'use strict';
const router=require('express').Router();
const crypto=require('crypto');
const { query,transaction }=require('../db/db');
const { withTenant }=require('../db/tenant');
const { wrap,validate,Joi,fail }=require('../services/validation');
const { issueSession,hashToken }=require('../services/sessions');
const { audit }=require('../services/audit');
const { createOidcClient }=require('../services/oidc-client');
const cookieName='__Host-rsx_oidc';
const consoleCookie='__Host-rsx_console';
const cookieOptions={ httpOnly:true,secure:true,sameSite:'lax',path:'/' };
function seal(value,key) {
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),data].map(v => v.toString('base64url')).join('.');
}
function unseal(value,key) {
  const [iv,tag,data]=value.split('.').map(v => Buffer.from(v,'base64url'));
  const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'));
}
async function providerFor(req) {
  const provider=req.app.locals.config.oidcProviders.find(p => p.id===req.params.provider);
  if (!provider) fail(404,'Identity provider unavailable');
  await require('../services/sso-settings').assertEnabled(provider);
  return provider;
}
router.get('/:provider/start',wrap(async (req,res) => {
  const provider=await providerFor(req),state=crypto.randomBytes(32).toString('base64url'),browser=crypto.randomBytes(32).toString('base64url');
  const consoleReturn=validate(Joi.object({ return:Joi.string().valid('console') }),req.query).return==='console';
  const context={ verifier:crypto.randomBytes(32).toString('base64url'),nonce:crypto.randomBytes(32).toString('base64url'),state,consoleReturn };
  let client;
  try { client=await createOidcClient(provider); }
  catch { fail(503,'Identity provider unavailable','OIDC_UNAVAILABLE'); }
  const authorization=await client.start(context);
  await withTenant(provider.organizationId,() => transaction(async () => {
    if (!(await query('SELECT id FROM organizations WHERE id=$1 AND is_active',[provider.organizationId])).rows.length) fail(403,'Organization unavailable');
    await query('DELETE FROM oidc_transactions WHERE expires_at<NOW()');
    await query(`INSERT INTO oidc_transactions(provider_id,state_hash,browser_hash,sealed_context,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')`,
      [provider.id,hashToken(state),hashToken(browser),seal(context,req.app.locals.config.OIDC_STATE_KEY)]);
  }));
  res.cookie(cookieName,browser,{ ...cookieOptions,maxAge:300000 });
  res.redirect(303,authorization);
}));
router.get('/:provider/callback',wrap(async (req,res) => {
  const provider=await providerFor(req);
  const values=validate(Joi.object({ state:Joi.string().pattern(/^[A-Za-z0-9_-]{43}$/).required(),code:Joi.string().min(1).max(4096),
    error:Joi.string().max(100),error_description:Joi.string().max(1000),iss:Joi.string().uri().max(2048),session_state:Joi.string().max(2048) }).xor('code','error'),req.query);
  const browser=(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (!browser || !/^[A-Za-z0-9_-]{43}$/.test(browser)) fail(401,'OIDC browser binding missing','OIDC_INVALID_RESPONSE');
  res.clearCookie(cookieName,cookieOptions);
  const flow=await withTenant(provider.organizationId,() => transaction(async () => {
    return (await query(`DELETE FROM oidc_transactions WHERE provider_id=$1 AND state_hash=$2 AND browser_hash=$3 AND expires_at>NOW() RETURNING sealed_context`,
      [provider.id,hashToken(values.state),hashToken(browser)])).rows[0];
  }));
  if (!flow) fail(401,'OIDC state invalid or expired','OIDC_INVALID_RESPONSE');
  let identity,context;
  try {
    const client=await createOidcClient(provider);
    const callback=new URL(provider.redirectUri); callback.search=new URLSearchParams(values).toString();
    context=unseal(flow.sealed_context,req.app.locals.config.OIDC_STATE_KEY);
    identity=await client.finish(callback.toString(),context);
    if (identity.issuer!==provider.issuer || identity.authenticatedAt.getTime()>Date.now()+30000) throw new Error('Invalid provider claims');
  } catch {
    req.app.get('logger').warn({ event:'oidc.denied',requestId:req.requestId,reason:'INVALID_RESPONSE' });
    fail(401,'OIDC response rejected','OIDC_INVALID_RESPONSE');
  }
  const grant=context.consoleReturn ? crypto.randomBytes(32).toString('base64url') : null;
  const result=await withTenant(provider.organizationId,() => transaction(async () => {
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,11))',[provider.organizationId+':'+provider.id]);
    await require('../services/sso-settings').assertEnabled(provider);
    // Lock directory state before account rows, matching provisioning and disable order.
    await query('SELECT id FROM directory_connections WHERE provider_id=$1 ORDER BY id FOR SHARE',[provider.id]);
    let user=(await query(`SELECT u.* FROM users u JOIN identity_links l ON l.user_id=u.id AND l.organization_id=u.organization_id
      JOIN organizations o ON o.id=u.organization_id WHERE l.provider_id=$1 AND l.issuer=$2 AND l.subject=$3 AND o.is_active AND u.is_active AND NOT u.is_locked FOR UPDATE OF u`,
      [provider.id,identity.issuer,identity.subject])).rows[0];
    if (!user && identity.provisionedSubject) {
      const candidates=await query(`SELECT u.* FROM users u JOIN directory_connections d ON d.id=u.directory_id AND d.organization_id=u.organization_id
        JOIN organizations o ON o.id=u.organization_id WHERE d.provider_id=$1 AND d.sso_linking AND d.is_active AND o.is_active
        AND u.scim_external_id=$2 AND u.scim_deleted_at IS NULL AND u.is_active AND NOT u.is_locked FOR UPDATE OF u`,[provider.id,identity.provisionedSubject]);
      if (candidates.rowCount===1) {
        user=candidates.rows[0];
        const link=await query(`INSERT INTO identity_links(user_id,provider_id,issuer,subject) VALUES($1,$2,$3,$4)
          ON CONFLICT(organization_id,issuer,subject) DO UPDATE SET subject=EXCLUDED.subject WHERE identity_links.user_id=EXCLUDED.user_id RETURNING id`,[user.id,provider.id,identity.issuer,identity.subject]);
        if (!link.rowCount) return { unlinked:true };
        req.user={ sub:user.id };await audit(req,'identity.directory_link',link.rows[0].id);
      }
    }
    if (!user) return { unlinked:true };
    if (grant && !['admin','superadmin'].includes(user.role)) return { denied:'ADMIN_REQUIRED' };
    req.user={ sub:user.id };
    const session=await issueSession(req,user,null,null,{ authentication_method:'oidc',mfa_verified:identity.mfaVerified,authenticated_at:identity.authenticatedAt,oidc_provider_id:provider.id });
    await audit(req,'oidc.login',user.id);
    if (grant && !session.denied) {
      await query('DELETE FROM oidc_console_grants WHERE expires_at<=NOW()');
      await query(`INSERT INTO oidc_console_grants(provider_id,grant_hash,sealed_session,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '60 seconds')`,
        [provider.id,hashToken(grant),seal(session,req.app.locals.config.OIDC_STATE_KEY)]);
    }
    return session;
  }));
  if (result.unlinked) fail(403,'Enterprise identity is not linked to an active local account','IDENTITY_NOT_LINKED');
  if (result.denied) fail(403,'Access policy denied enterprise authentication',result.denied);
  if (grant) {
    res.cookie(consoleCookie,grant,{ ...cookieOptions,sameSite:'strict',maxAge:60000 });
    return res.redirect(303,'/admin/#sso='+provider.id);
  }
  res.json({ message:'Enterprise login successful',...result });
}));
router.post('/:provider/console-session',wrap(async(req,res)=>{
  const provider=await providerFor(req);
  if (req.get('origin')!==new URL(provider.redirectUri).origin) fail(403,'Console origin required');
  const token=(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(consoleCookie+'='))?.slice(consoleCookie.length+1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) fail(401,'Console handoff unavailable');
  res.clearCookie(consoleCookie,{ ...cookieOptions,sameSite:'strict' });
  const grant=await withTenant(provider.organizationId,()=>transaction(async()=>{
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,11))',[provider.organizationId+':'+provider.id]);
    await require('../services/sso-settings').assertEnabled(provider);
    return (await query(`DELETE FROM oidc_console_grants WHERE provider_id=$1 AND grant_hash=$2 AND expires_at>NOW()
      AND EXISTS(SELECT 1 FROM organizations WHERE id=$3 AND is_active) RETURNING sealed_session`,[provider.id,hashToken(token),provider.organizationId])).rows[0];
  }));
  if (!grant) fail(401,'Console handoff expired or consumed');
  res.json(unseal(grant.sealed_session,req.app.locals.config.OIDC_STATE_KEY));
}));
module.exports=router;
