'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query,transaction } = require('../db/db');
const { withTenant,tenantId,DEFAULT_ORGANIZATION } = require('../db/tenant');
const { Joi,validate,userRegistration,wrap,fail } = require('../services/validation');
const { audit } = require('../services/audit');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
function tokens(config,user,deviceId) {
  const claims = { sub:user.id,role:user.role,organizationId:tenantId(),...(deviceId ? { deviceId } : {}) };
  return {
    accessToken:jwt.sign(claims,config.JWT_SECRET,{ expiresIn:config.JWT_EXPIRES_IN,jwtid:crypto.randomUUID(),algorithm:'HS256' }),
    refreshToken:jwt.sign({ sub:user.id,organizationId:tenantId(),type:'refresh' },config.JWT_REFRESH_SECRET,
      { expiresIn:config.JWT_REFRESH_EXPIRES_IN,jwtid:crypto.randomUUID(),algorithm:'HS256' }),
  };
}
async function issueSession(req,user,deviceId,deviceOs) {
  // Caller holds a user row lock; login/refresh/logout serialize across processes.
  const issued = tokens(req.app.locals.config,user,deviceId);
  const expiresAt = new Date(jwt.decode(issued.accessToken).exp*1000);
  await query(`UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1 AND is_active
    AND id NOT IN (SELECT id FROM sessions WHERE user_id=$1 AND is_active AND expires_at>NOW() ORDER BY started_at DESC,id LIMIT $2)`,
  [user.id,req.app.locals.config.MAX_SESSIONS_PER_USER-1]);
  await query(`INSERT INTO sessions(user_id,token_hash,refresh_hash,refresh_expires_at,device_id,device_os,vpn_ip,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[user.id,hashToken(issued.accessToken),hashToken(issued.refreshToken),
    new Date(jwt.decode(issued.refreshToken).exp*1000),deviceId || null,deviceOs || null,req.vpnClientIp || req.ip,expiresAt]);
  return { user:{ id:user.id,username:user.username,role:user.role,organizationId:tenantId() },...issued,expiresAt:expiresAt.toISOString() };
}
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
    const user = await createUser(req,value);
    req.user = { sub:user.id };
    const session = await issueSession(req,user,value.deviceId);
    await audit(req,'register',user.id);
    return session;
  }));
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
    if (deviceId && (await query("SELECT id FROM devices WHERE external_id=$1 AND (status='revoked' OR user_id<>$2)",[deviceId,user.id])).rows.length) fail(403,'Device unavailable');
    req.user = { sub:user.id };
    const session = await issueSession(req,user,deviceId,deviceOs);
    await query('UPDATE users SET last_login=NOW() WHERE id=$1',[user.id]);
    await audit(req,'login',user.id);
    return session;
  }));
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
    if (!session) fail(401,'Invalid or expired refresh token');
    await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE id=$1',[session.id]);
    req.user={ sub:user.id };
    const issued=await issueSession(req,user,session.device_id,session.device_os);
    await audit(req,'refresh',session.id);
    return issued;
  }));
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
module.exports=router;
module.exports.createUser=createUser;
