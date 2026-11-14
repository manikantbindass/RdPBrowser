'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query,transaction } = require('../db/db');
const { withTenant,tenantId,DEFAULT_ORGANIZATION } = require('../db/tenant');
const { Joi,validate,userRegistration,wrap,fail } = require('../services/validation');
const { audit } = require('../services/audit');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();
const { issueSession,hashToken }=require('../services/sessions');
async function sessionStatus(req,res){
  const {session,device}=req.accessContext;
  const {decide}=require('../services/access');
  const access=decide({...req.accessContext,policy:req.accessContext.policy.configuration,resource:'browser.navigate'});
  await require('../services/access').recordDecision(req,req.accessContext.user,session,device,access,req.accessContext.policy.revision);
  const urls=req.method==='POST'?validate(Joi.object({urls:Joi.array().items(Joi.string().uri({scheme:['http','https']}).max(8192)).max(20).required()}),req.body).urls:[];
  if (req.method==='POST') require('./proxy').navigationCountry(req);
  const decisions=access.allowed?await Promise.all(urls.map(url=>require('../services/policy').evaluate(url))):[];
  const sourceGate=req.app.locals.config.VPN_REQUIRED?'accepted':'disabled';
  res.json({user:{id:req.user.sub,role:req.user.role,organizationId:req.user.organizationId},session:{id:session.id,expiresAt:session.expires_at,absoluteExpiresAt:session.absolute_expires_at},device:device?{id:device.id,name:device.name,trustState:device.trust_state,status:device.status,postureValidUntil:device.posture_valid_until}:null,access,decisions,sourceGate});
}
const statusLimit=require('express-rate-limit')({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false,
  handler:(req,res)=>res.status(429).json({error:'Session status quota exceeded'})});
router.route('/status').get(statusLimit,authenticateToken,wrap(sessionStatus)).post(statusLimit,authenticateToken,wrap(sessionStatus));
async function ensureOrganization() {
  if (!(await query('SELECT id FROM organizations WHERE id=$1 AND is_active',[tenantId()])).rows.length) fail(401,'Invalid credentials');
}
async function createUser(req,value) {
  const { username,email,password,deviceId } = value;
  const passwordHash = await bcrypt.hash(password,12);
  return (await query('INSERT INTO users(username,email,password_hash,device_id) VALUES($1,$2,$3,$4) RETURNING id,username,role',
    [username,email.toLowerCase(),passwordHash,deviceId || null])).rows[0];
}
router.post('/register',wrap(async (req,res) => {
  const value = validate(userRegistration,req.body);
  if (!req.app.locals.config.REGISTRATION_ENABLED) fail(403,'Public registration disabled');
  const result = await withTenant(DEFAULT_ORGANIZATION,() => transaction(async () => {
    await ensureOrganization();
    const policy=await require('../services/access').loadPolicy();
    if (!policy.configuration.allowedAuthMethods.includes('password') || policy.configuration.requireMfa || !policy.configuration.allowedRoles.includes('user')) fail(403,'Organization requires enterprise authentication','SSO_REQUIRED');
    const user = await createUser(req,value);
    req.user = { sub:user.id };
    const session = await issueSession(req,user,value.deviceId);
    await audit(req,'register',user.id);
    return session;
  }));
  if (result.denied) fail(403,'Access policy denied authentication',result.denied);
  res.status(201).json({ message:'User registered successfully',...result });
}));
router.post('/login',require('../contracts').validateBody('loginRequest'),wrap(async (req,res) => {
  const { username,password,deviceId,deviceOs,organizationId=DEFAULT_ORGANIZATION } = req.body;
  const result = await withTenant(organizationId,() => transaction(async () => {
    await ensureOrganization();
    const user = (await query('SELECT * FROM users WHERE username=$1 FOR UPDATE',[username])).rows[0];
    const valid = await bcrypt.compare(password,user?.password_hash || '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxY6qM3LqH/OmZ0bDymXbD1N1wG');
    if (!user || !valid) fail(401,'Invalid credentials');
    if (!user.is_active || user.is_locked) fail(403,'Account unavailable');
    if (req.app.locals.config.DEVICE_BINDING_ENABLED && user.device_id && user.device_id!==deviceId) fail(403,'Device not authorized for this account');
    if (deviceId && (await query("SELECT id FROM devices WHERE external_id=$1 AND (status='revoked' OR trust_state IN ('revoked','quarantined') OR user_id<>$2)",[deviceId,user.id])).rows.length) fail(403,'Device unavailable');
    req.user = { sub:user.id };
    const session = await issueSession(req,user,deviceId,deviceOs);
    await query('UPDATE users SET last_login=NOW() WHERE id=$1',[user.id]);
    await audit(req,'login',user.id);
    return session;
  }));
  if (result.denied) fail(403,'Access policy denied authentication',result.denied);
  await req.app.get('io')?.emitToAdmins(organizationId,'user_logged_in',{ userId:result.user.id,username,deviceOs,timestamp:new Date().toISOString() });
  res.json({ message:'Login successful',...result });
}));
router.post('/refresh',wrap(async (req,res) => {
  const { refreshToken } = validate(Joi.object({ refreshToken:Joi.string().max(4096).required() }),req.body);
  let payload;
  try { payload=jwt.verify(refreshToken,req.app.locals.config.JWT_REFRESH_SECRET,{ algorithms:['HS256'] }); }
  catch { fail(401,'Invalid or expired refresh token'); }
  if (payload.type!=='refresh' || !payload.organizationId) fail(401,'Login required after upgrade');
  const result = await withTenant(payload.organizationId,() => transaction(async () => {
    await ensureOrganization();
    const user = (await query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[payload.sub])).rows[0];
    if (!user || !user.is_active || user.is_locked) fail(401,'Account unavailable');
    const session = (await query('SELECT * FROM sessions WHERE user_id=$1 AND refresh_hash=$2 AND is_active AND refresh_expires_at>NOW() FOR UPDATE',
      [user.id,hashToken(refreshToken)])).rows[0];
    if (!session) {
      const used=(await query('SELECT family_id FROM used_refresh_tokens WHERE user_id=$1 AND token_hash=$2 AND expires_at>NOW()',[user.id,hashToken(refreshToken)])).rows[0];
      if (used) {
        await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1 AND family_id=$2',[user.id,used.family_id]);
        req.user={ sub:user.id }; await audit(req,'refresh.reuse',user.id);
      }
      return { invalid:true };
    }
    await query('DELETE FROM used_refresh_tokens WHERE expires_at<NOW()');
    await query('INSERT INTO used_refresh_tokens(user_id,token_hash,family_id,expires_at) VALUES($1,$2,$3,$4)',[user.id,hashToken(refreshToken),session.family_id,session.absolute_expires_at]);
    await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE id=$1',[session.id]);
    req.user={ sub:user.id };
    const issued=await issueSession(req,user,session.device_id,session.device_os,session);
    await audit(req,'refresh',session.id);
    return issued;
  }));
  if (result.invalid) fail(401,'Invalid or expired refresh token');
  if (result.denied) fail(403,'Access policy denied refresh',result.denied);
  res.json(result);
}));
router.post('/logout',authenticateToken,wrap(async (req,res) => {
  await transaction(async () => {
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.sub]);
    await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE id=$1',[req.sessionId]);
    await audit(req,'logout',req.sessionId);
  });
  res.json({ message:'Logged out successfully' });
}));
router.use('/oidc',require('./oidc'));
module.exports=router;
module.exports.createUser=createUser;
