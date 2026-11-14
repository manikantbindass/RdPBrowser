'use strict';
const jwt=require('jsonwebtoken');
const crypto=require('crypto');
const { query }=require('../db/db');
const { tenantId }=require('../db/tenant');
const { loadPolicy,decide,recordDecision }=require('./access');
const hashToken=token => crypto.createHash('sha256').update(token).digest('hex');
function durationSeconds(value) { const parts=value.match(/^(\d+)([smhd])$/); return Number(parts[1])*({ s:1,m:60,h:3600,d:86400 })[parts[2]]; }
async function issueSession(req,user,deviceId,deviceOs,previous) {
  const config=req.app.locals.config;
  const policy=await loadPolicy();
  const now=new Date();
  const absolute=previous?.absolute_expires_at ? new Date(previous.absolute_expires_at) : new Date(now.getTime()+Math.min(durationSeconds(config.JWT_REFRESH_EXPIRES_IN),policy.configuration.sessionMaxAgeSeconds)*1000);
  const session={ organization_id:tenantId(),is_active:true,absolute_expires_at:absolute,last_activity:previous?.last_activity || now,
    authenticated_at:previous?.authenticated_at || now,authentication_method:previous?.authentication_method || 'password',mfa_verified:previous?.mfa_verified || false,
    registered_device_id:previous?.registered_device_id || null,device_proved_at:previous?.device_proved_at || null };
  const device=session.registered_device_id ? (await query('SELECT * FROM devices WHERE id=$1 AND user_id=$2',[session.registered_device_id,user.id])).rows[0] :
    deviceId ? (await query('SELECT * FROM devices WHERE external_id=$1',[deviceId])).rows[0] : null;
  const principal={ ...user,organization_id:tenantId(),organization_active:true,is_active:user.is_active!==false,is_locked:!!user.is_locked };
  const decision=decide({ user:principal,session,device,resource:'auth.login',policy:policy.configuration,login:true });
  if (session.registered_device_id && !device) decision.allowed=false,decision.reason='DEVICE_INVALID';
  await recordDecision(req,principal,null,device,decision,policy.revision);
  if (!decision.allowed) return { denied:decision.reason };
  const accessSeconds=Math.min(durationSeconds(config.JWT_EXPIRES_IN),Math.floor((absolute-now)/1000));
  if (accessSeconds<1) return { denied:'SESSION_ABSOLUTE_EXPIRED' };
  const claims={ sub:user.id,role:user.role,organizationId:tenantId(),type:'access',...(deviceId ? { deviceId } : {}) };
  const accessToken=jwt.sign(claims,config.JWT_SECRET,{ expiresIn:accessSeconds,jwtid:crypto.randomUUID(),algorithm:'HS256' });
  const refreshToken=jwt.sign({ sub:user.id,organizationId:tenantId(),type:'refresh' },config.JWT_REFRESH_SECRET,
    { expiresIn:Math.max(1,Math.floor((absolute-now)/1000)),jwtid:crypto.randomUUID(),algorithm:'HS256' });
  const expiresAt=new Date(jwt.decode(accessToken).exp*1000);
  await query(`UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1 AND is_active
    AND id NOT IN (SELECT id FROM sessions WHERE user_id=$1 AND is_active AND expires_at>NOW() ORDER BY started_at DESC,id LIMIT $2)`,[user.id,config.MAX_SESSIONS_PER_USER-1]);
  await query(`INSERT INTO sessions(user_id,token_hash,refresh_hash,refresh_expires_at,device_id,device_os,vpn_ip,expires_at,
    family_id,absolute_expires_at,authentication_method,mfa_verified,authenticated_at,registered_device_id,device_proved_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[user.id,hashToken(accessToken),hashToken(refreshToken),absolute,
    deviceId || null,deviceOs || null,req.vpnClientIp || req.ip || null,expiresAt,previous?.family_id || crypto.randomUUID(),absolute,
    session.authentication_method,session.mfa_verified,session.authenticated_at,session.registered_device_id,session.device_proved_at]);
  return { user:{ id:user.id,username:user.username,role:user.role,organizationId:tenantId() },accessToken,refreshToken,expiresAt:expiresAt.toISOString() };
}
module.exports={ issueSession,hashToken,durationSeconds };
