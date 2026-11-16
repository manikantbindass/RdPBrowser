'use strict';
const router=require('express').Router();
const { query,transaction }=require('../db/db');
const { tenantId }=require('../db/tenant');
const { Joi,validate,id,userRegistration,pagination,wrap,fail }=require('../services/validation');
const { audit }=require('../services/audit');
const { createUser }=require('./auth');
const { evaluate }=require('../services/policy');
const { managedUser }=require('../services/admin-roles');
const admin=req => ['admin','superadmin'].includes(req.user.role);
function requireAdmin(req) { if (!admin(req)) fail(403,'Admin access required'); }
function resourceId(req) { return validate(id.required(),req.params.id); }
function found(result) { if (!result.rows.length) fail(404,'Resource not found'); return result.rows[0]; }
async function mutation(req,action,target,fn) {
  return transaction(async () => { const result=await fn(); await audit(req,action,target || result?.id); return result; });
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
    await managedUser(req.user,device.user_id,true);
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
    await managedUser(req.user,session.user_id,true);
    await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE id=$1',[sessionId]);
  });
  res.json({ message:'Session terminated' });
}));
const pattern=Joi.string().min(1).max(500);
const assignmentSchema=Joi.object({
  scope:Joi.string().valid('organization','users','groups').required(),
  userIds:Joi.array().items(id).unique().max(100).required()
    .when('scope',{ is:'users',then:Joi.array().min(1),otherwise:Joi.array().length(0) }),
  groupIds:Joi.array().items(id).unique().max(100).when('scope',{ is:'groups',then:Joi.array().min(1).required(),otherwise:Joi.array().length(0) }),
});
const policySchema=Joi.object({ name:Joi.string().min(1).max(160).required(),rules:Joi.object({ deny:Joi.array().items(pattern).max(100).required(),allow:Joi.array().items(pattern).max(100).required() }).required(),isActive:Joi.boolean().default(true),
  assignment:assignmentSchema });
const organizationAssignment={ scope:'organization',userIds:[] };
async function getAssignment(policyId, scope) {
  if (scope==='organization') return organizationAssignment;
  if (scope==='groups') return { scope,userIds:[],groupIds:(await query('SELECT group_id FROM policy_group_assignments WHERE policy_id=$1 ORDER BY group_id',[policyId])).rows.map(r=>r.group_id) };
  const { rows }=await query('SELECT user_id FROM policy_user_assignments WHERE policy_id=$1 ORDER BY user_id',[policyId]);
  return { scope,userIds:rows.map(row => row.user_id) };
}
async function saveAssignment(policyId, assignment) {
  if (assignment.userIds.length) {
    const { rowCount }=await query('SELECT id FROM users WHERE id=ANY($1::uuid[])',[assignment.userIds]);
    if (rowCount!==assignment.userIds.length) fail(400,'One or more assignment users are unavailable','ASSIGNMENT_USER_UNAVAILABLE');
  }
  await query('DELETE FROM policy_user_assignments WHERE policy_id=$1',[policyId]);
  await query('DELETE FROM policy_group_assignments WHERE policy_id=$1',[policyId]);
  if (assignment.userIds.length) {
    await query('INSERT INTO policy_user_assignments(policy_id,user_id) SELECT $1,unnest($2::uuid[])',[policyId,assignment.userIds]);
  }
  if (assignment.scope==='groups') {
    const groups=await query('SELECT g.id FROM directory_groups g JOIN directory_connections d ON d.id=g.directory_id AND d.organization_id=g.organization_id WHERE g.id=ANY($1::uuid[]) AND NOT g.is_deleted AND d.is_active',[assignment.groupIds]);
    if (groups.rowCount!==assignment.groupIds.length) fail(400,'One or more assignment groups are unavailable','ASSIGNMENT_GROUP_UNAVAILABLE');
    await query('INSERT INTO policy_group_assignments(policy_id,group_id) SELECT $1,unnest($2::uuid[])',[policyId,assignment.groupIds]);
  }
}
async function snapshot(req, policy, assignment) {
  await query(`INSERT INTO policy_versions(policy_id,revision,name,rules,is_active,assignment,actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[policy.id,policy.revision,policy.name,policy.rules,policy.is_active,assignment,req.user.sub]);
  return { ...policy,assignment };
}
const listPolicies=wrap(async (req,res) => {
  const { limit,offset,page }=pagination(req);
  const full=req.path==='/admin/policies';
  if (full) requireAdmin(req);
  const result=await query(`SELECT p.id,p.name,p.revision,p.rules,p.is_active,p.created_at,p.updated_at,
      jsonb_build_object('scope',p.assignment_scope,'userIds',CASE WHEN $5 THEN COALESCE((
        SELECT jsonb_agg(a.user_id ORDER BY a.user_id) FROM policy_user_assignments a WHERE a.policy_id=p.id
      ),'[]'::jsonb) ELSE '[]'::jsonb END) || CASE WHEN p.assignment_scope='groups' THEN
        jsonb_build_object('groupIds',CASE WHEN $5 THEN COALESCE((SELECT jsonb_agg(a.group_id ORDER BY a.group_id) FROM policy_group_assignments a WHERE a.policy_id=p.id),'[]'::jsonb) ELSE '[]'::jsonb END)
        ELSE '{}'::jsonb END AS assignment
    FROM policies p WHERE p.organization_id=$1 AND ($5 OR p.assignment_scope='organization' OR EXISTS (
      SELECT 1 FROM policy_user_assignments a WHERE a.policy_id=p.id AND a.user_id=$4
    ) OR EXISTS (SELECT 1 FROM policy_group_assignments a JOIN directory_members m ON m.group_id=a.group_id AND m.organization_id=a.organization_id JOIN directory_groups g ON g.id=m.group_id AND g.organization_id=m.organization_id
      WHERE a.policy_id=p.id AND m.user_id=$4 AND NOT g.is_deleted
    )) ORDER BY p.created_at DESC,p.id LIMIT $2 OFFSET $3`,[tenantId(),limit,offset,req.user.sub,full]);
  res.json({ policies:result.rows,page,limit });
});
router.get('/policies',listPolicies);
router.get('/admin/policies',listPolicies);
router.post('/policies',wrap(async (req,res) => {
  requireAdmin(req); const value=validate(policySchema,req.body);
  const assignment=value.assignment || organizationAssignment;
  const policy=await mutation(req,'policy.create',null,async () => {
    const row=found(await query('INSERT INTO policies(name,rules,is_active,assignment_scope) VALUES($1,$2,$3,$4) RETURNING *',
      [value.name,value.rules,value.isActive,assignment.scope]));
    await saveAssignment(row.id,assignment);
    return snapshot(req,row,assignment);
  });
  res.status(201).json({ policy });
}));
router.put('/policies/:id',wrap(async (req,res) => {
  requireAdmin(req); const policyId=resourceId(req);
  const value=validate(policySchema.keys({ revision:Joi.number().integer().min(1).max(2147483646).required() }),req.body);
  const policy=await mutation(req,'policy.update',policyId,async () => {
    const existing=found(await query('SELECT revision,assignment_scope FROM policies WHERE id=$1 AND organization_id=$2 FOR UPDATE',[policyId,tenantId()]));
    if (existing.revision!==value.revision) fail(409,'Policy revision conflict');
    const assignment=value.assignment || await getAssignment(policyId,existing.assignment_scope);
    const row=found(await query('UPDATE policies SET name=$1,rules=$2,is_active=$3,assignment_scope=$4,revision=revision+1,updated_at=NOW() WHERE id=$5 RETURNING *',
      [value.name,value.rules,value.isActive,assignment.scope,policyId]));
    if (value.assignment) await saveAssignment(policyId,assignment);
    return snapshot(req,row,assignment);
  });
  res.json({ policy });
}));
router.post('/policies/evaluate',wrap(async (req,res) => {
  const { url }=validate(Joi.object({ url:Joi.string().uri({ scheme:['http','https'] }).max(8192).required() }),req.body);
  res.json(await evaluate(url,req.user.sub));
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
    const signal={ 'vpn.disconnected':'client.vpn_disconnected','vpn.bypass_suspected':'client.vpn_bypass' }[value.eventType];
    if (result.rows.length && signal) await require('../services/detection-signals').observe(req,signal,{ trust:'client_report',reason:'UNVERIFIED_CLIENT_REPORT' });
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
