'use strict';
const router=require('express').Router();
const { query,transaction }=require('../db/db');
const { tenantId }=require('../db/tenant');
const { Joi,validate,id,userRegistration,pagination,wrap,fail }=require('../services/validation');
const { audit }=require('../services/audit');
const { createUser }=require('./auth');
const { evaluate }=require('../services/policy');
const admin=req => ['admin','superadmin'].includes(req.user.role);
function requireAdmin(req) { if (!admin(req)) fail(403,'Admin access required'); }
function resourceId(req) { return validate(id.required(),req.params.id); }
function found(result) { if (!result.rows.length) fail(404,'Resource not found'); return result.rows[0]; }
async function mutation(req,action,target,fn) {
  return transaction(async () => { const result=await fn(); await audit(req,action,target); return result; });
}
router.get('/organization',wrap(async (req,res) => {
  res.json({ organization:found(await query('SELECT id,name,is_active,created_at FROM organizations WHERE id=$1',[tenantId()])) });
}));
router.post('/users',wrap(async (req,res) => {
  requireAdmin(req);
  const value=validate(userRegistration,req.body);
  const user=await transaction(async () => { const row=await createUser(req,value); await audit(req,'user.register',row.id); return row; });
  res.status(201).json({ user });
}));
router.get('/devices',wrap(async (req,res) => {
  const { limit,offset,page }=pagination(req);
  const status=req.query.status;
  if (status!==undefined) validate(Joi.string().valid('registered','revoked'),status);
  const result=await query(`SELECT id,user_id,external_id,name,platform,status,trust_state,posture_valid_until,created_at FROM devices
    WHERE organization_id=$1 AND ($2::uuid IS NULL OR user_id=$2) AND ($3::text IS NULL OR status=$3)
    ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`,[tenantId(),admin(req) ? null : req.user.sub,status || null,limit,offset]);
  res.json({ devices:result.rows,page,limit });
}));
router.post('/devices',wrap(async (req,res) => {
  const value=validate(Joi.object({ externalId:Joi.string().min(1).max(255).required(),name:Joi.string().min(1).max(160).required(),platform:Joi.string().valid('windows','linux','macos','android').required() }),req.body);
  const device=await mutation(req,'device.register',null,async () => found(await query(`INSERT INTO devices(user_id,external_id,name,platform)
    VALUES($1,$2,$3,$4) RETURNING id,user_id,external_id,name,platform,status,created_at`,[req.user.sub,value.externalId,value.name,value.platform])));
  res.status(201).json({ device });
}));
router.delete('/devices/:id',wrap(async (req,res) => {
  const deviceId=resourceId(req);
  await mutation(req,'device.revoke',deviceId,async () => {
    const device=found(await query(`SELECT * FROM devices WHERE id=$1 AND organization_id=$2
      AND ($3::uuid IS NULL OR user_id=$3) FOR UPDATE`,[deviceId,tenantId(),admin(req) ? null : req.user.sub]));
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[device.user_id]);
    await query("UPDATE devices SET status='revoked' WHERE id=$1",[deviceId]);
    await query("UPDATE devices SET trust_state='revoked',posture_valid_until=NULL WHERE id=$1",[deviceId]);
    await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1 AND (device_id=$2 OR registered_device_id=$3)',[device.user_id,device.external_id,deviceId]);
  });
  res.json({ message:'Device revoked' });
}));
router.get('/sessions',wrap(async (req,res) => {
  const { limit,offset,page }=pagination(req);
  const active=req.query.active;
  if (active!==undefined) validate(Joi.string().valid('true','false'),active);
  const result=await query(`SELECT id,user_id,device_id,device_os,is_active,started_at,expires_at FROM sessions
    WHERE organization_id=$1 AND ($2::uuid IS NULL OR user_id=$2) AND ($3::boolean IS NULL OR is_active=$3)
    ORDER BY started_at DESC,id LIMIT $4 OFFSET $5`,[tenantId(),admin(req) ? null : req.user.sub,active===undefined ? null : active==='true',limit,offset]);
  res.json({ sessions:result.rows,page,limit });
}));
router.delete('/sessions/:id',wrap(async (req,res) => {
  const sessionId=resourceId(req);
  await mutation(req,'session.revoke',sessionId,async () => {
    const session=found(await query('SELECT user_id FROM sessions WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR user_id=$3)',
      [sessionId,tenantId(),admin(req) ? null : req.user.sub]));
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[session.user_id]);
    await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE id=$1',[sessionId]);
  });
  res.json({ message:'Session terminated' });
}));
const pattern=Joi.string().min(1).max(500);
const policySchema=Joi.object({ name:Joi.string().min(1).max(160).required(),rules:Joi.object({ deny:Joi.array().items(pattern).max(100).required(),allow:Joi.array().items(pattern).max(100).required() }).required(),isActive:Joi.boolean().default(true) });
router.get('/policies',wrap(async (req,res) => {
  const { limit,offset,page }=pagination(req);
  const result=await query('SELECT id,name,revision,rules,is_active,created_at,updated_at FROM policies WHERE organization_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[tenantId(),limit,offset]);
  res.json({ policies:result.rows,page,limit });
}));
router.post('/policies',wrap(async (req,res) => {
  requireAdmin(req); const value=validate(policySchema,req.body);
  const policy=await mutation(req,'policy.create',null,async () => found(await query('INSERT INTO policies(name,rules,is_active) VALUES($1,$2,$3) RETURNING *',[value.name,value.rules,value.isActive])));
  res.status(201).json({ policy });
}));
router.put('/policies/:id',wrap(async (req,res) => {
  requireAdmin(req); const policyId=resourceId(req);
  const value=validate(policySchema.keys({ revision:Joi.number().integer().min(1).max(2147483646).required() }),req.body);
  const policy=await mutation(req,'policy.update',policyId,async () => {
    const existing=found(await query('SELECT revision FROM policies WHERE id=$1 AND organization_id=$2 FOR UPDATE',[policyId,tenantId()]));
    if (existing.revision!==value.revision) fail(409,'Policy revision conflict');
    return found(await query('UPDATE policies SET name=$1,rules=$2,is_active=$3,revision=revision+1,updated_at=NOW() WHERE id=$4 RETURNING *',[value.name,value.rules,value.isActive,policyId]));
  });
  res.json({ policy });
}));
router.post('/policies/evaluate',wrap(async (req,res) => {
  const { url }=validate(Joi.object({ url:Joi.string().uri({ scheme:['http','https'] }).max(8192).required() }),req.body);
  res.json(await evaluate(url));
}));
router.post('/events',wrap(async (req,res) => {
  const value=validate(Joi.object({ clientEventId:id.required(),deviceId:id, eventType:Joi.string().pattern(/^[a-z][a-z0-9_.-]{0,79}$/).required(),
    severity:Joi.string().valid('low','medium','high','critical').required(),occurredAt:Joi.string().isoDate().required() }),req.body);
  const timestamp=new Date(value.occurredAt);
  if (timestamp>Date.now()+300000 || timestamp<Date.now()-7*86400000) fail(400,'Event timestamp outside ingestion window');
  const event=await mutation(req,'event.ingest',value.clientEventId,async () => {
    if (value.deviceId) found(await query("SELECT id FROM devices WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND status='registered'",[value.deviceId,tenantId(),req.user.sub]));
    const result=await query(`INSERT INTO security_events(user_id,device_id,event_type,severity,client_event_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(organization_id,user_id,client_event_id) DO NOTHING RETURNING id,created_at`,[req.user.sub,value.deviceId || null,value.eventType,value.severity,value.clientEventId,timestamp]);
    return result.rows[0] || found(await query('SELECT id,created_at FROM security_events WHERE user_id=$1 AND client_event_id=$2',[req.user.sub,value.clientEventId]));
  });
  res.status(201).json({ event,trust:'untrusted-client-report' });
}));
router.get('/events',wrap(async (req,res) => {
  requireAdmin(req); const { limit,offset,page }=pagination(req);
  if (req.query.severity!==undefined) validate(Joi.string().valid('low','medium','high','critical'),req.query.severity);
  if (req.query.eventType!==undefined) validate(Joi.string().pattern(/^[a-z][a-z0-9_.-]{0,79}$/),req.query.eventType);
  const result=await query(`SELECT id,user_id,device_id,event_type,severity,occurred_at,created_at FROM security_events
    WHERE organization_id=$1 AND ($2::text IS NULL OR severity=$2) AND ($3::text IS NULL OR event_type=$3)
    ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`,[tenantId(),req.query.severity || null,req.query.eventType || null,limit,offset]);
  res.json({ events:result.rows,page,limit });
}));
module.exports=router;
