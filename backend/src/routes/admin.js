'use strict';
const router=require('express').Router();
const { query,transaction }=require('../db/db');
const { Joi,validate,id,pagination,wrap,fail }=require('../services/validation');
const { audit }=require('../services/audit');
router.use((req,res,next) => ['admin','superadmin'].includes(req.user.role) ? next() : res.status(403).json({ error:'Admin access required' }));
async function change(req,action,target,fn) {
  return transaction(async () => { const result=await fn(); await audit(req,action,target); return result; });
}
function affected(result) { if (!result.rowCount) fail(404,'Resource not found'); return result; }
const validateId=req => validate(id.required(),req.params.id);
// RLS and the tenant-required query service apply to every legacy query too.
router.get('/sessions',wrap(async (req,res) => {
  const { limit,offset }=pagination(req);
  const result=await query(`SELECT s.id,s.user_id,u.username,u.email,s.device_os,s.vpn_ip,s.public_ip,
    s.started_at,s.last_activity,s.expires_at,s.is_active FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.is_active=TRUE AND s.expires_at>NOW() ORDER BY s.last_activity DESC,s.id LIMIT $1 OFFSET $2`,[limit,offset]);
  res.json({ sessions:result.rows });
}));
router.post('/force-logout',wrap(async (req,res) => {
  const { userId,sessionId }=validate(Joi.object({ userId:id,sessionId:id }).xor('userId','sessionId'),req.body);
  await change(req,'force_logout',userId || sessionId,async () => {
    let target=userId;
    if (sessionId) { const row=(await query('SELECT user_id FROM sessions WHERE id=$1',[sessionId])).rows[0]; if (!row) fail(404,'Resource not found'); target=row.user_id; }
    affected(await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[target]));
    await query(`UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE ${sessionId ? 'id' : 'user_id'}=$1`,[sessionId || userId]);
  });
  await req.app.get('io')?.emitToAdmins(req.user.organizationId,'session_terminated',{ userId,sessionId,by:req.user.sub });
  res.json({ message:'Session(s) terminated' });
}));
router.get('/ip-logs',wrap(async (req,res) => {
  const { limit,offset,page }=pagination(req);
  if (req.query.flagged!==undefined) validate(Joi.string().valid('true','false'),req.query.flagged);
  const where=req.query.flagged==='true' ? 'WHERE l.flagged = TRUE' : req.query.flagged==='false' ? 'WHERE l.flagged = FALSE' : '';
  const result=await query(`SELECT l.id,l.request_ip,l.vpn_confirmed,l.url_requested,l.country_code,l.flagged,l.flag_reason,l.created_at,u.username
    FROM ip_logs l LEFT JOIN users u ON u.id=l.user_id ${where} ORDER BY l.created_at DESC,l.id LIMIT $1 OFFSET $2`,[limit,offset]);
  const count=await query(`SELECT COUNT(*) FROM ip_logs l ${where}`);
  res.json({ logs:result.rows,total:Number(count.rows[0].count),page,limit });
}));
router.get('/blocked-urls',wrap(async (req,res) => {
  const { limit,offset }=pagination(req);
  res.json({ blockedUrls:(await query('SELECT * FROM blocked_urls WHERE is_active=TRUE ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',[limit,offset])).rows });
}));
router.post('/blocked-urls',wrap(async (req,res) => {
  const value=validate(Joi.object({ pattern:Joi.string().min(1).max(500).required(),reason:Joi.string().max(255) }),req.body);
  const row=await change(req,'block_url',null,async () => (await query(`INSERT INTO blocked_urls(pattern,blocked_by,reason) VALUES($1,$2,$3)
    ON CONFLICT(organization_id,pattern) DO UPDATE SET is_active=TRUE,reason=$3 RETURNING *`,[value.pattern,req.user.sub,value.reason || null])).rows[0]);
  await req.app.get('io')?.emitToAdmins(req.user.organizationId,'url_blocked',row);
  res.status(201).json({ blockedUrl:row });
}));
router.delete('/blocked-urls/:id',wrap(async (req,res) => {
  const target=validateId(req);
  await change(req,'unblock_url',target,async () => affected(await query('UPDATE blocked_urls SET is_active=FALSE WHERE id=$1',[target])));
  res.json({ message:'URL unblocked' });
}));
router.get('/anomalies',wrap(async (req,res) => {
  const { limit,offset }=pagination(req);
  res.json({ anomalies:(await query(`SELECT a.*,u.username FROM anomaly_alerts a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.resolved=FALSE ORDER BY a.created_at DESC,a.id LIMIT $1 OFFSET $2`,[limit,offset])).rows });
}));
router.patch('/anomalies/:id/resolve',wrap(async (req,res) => {
  const target=validateId(req);
  await change(req,'anomaly.resolve',target,async () => affected(await query('UPDATE anomaly_alerts SET resolved=TRUE WHERE id=$1',[target])));
  res.json({ message:'Alert resolved' });
}));
router.get('/users',wrap(async (req,res) => {
  const { limit,offset }=pagination(req);
  res.json({ users:(await query('SELECT id,username,email,role,is_active,is_locked,last_login,created_at FROM users ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',[limit,offset])).rows });
}));
router.patch('/users/:id/lock',wrap(async (req,res) => {
  const target=validateId(req);
  const { locked }=validate(Joi.object({ locked:Joi.boolean().required() }),req.body);
  await change(req,locked ? 'lock_user' : 'unlock_user',target,async () => {
    affected(await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[target]));
    await query('UPDATE users SET is_locked=$1 WHERE id=$2',[locked,target]);
    if (locked) await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1',[target]);
  });
  res.json({ message:`User ${locked ? 'locked' : 'unlocked'}` });
}));
router.get('/stats',wrap(async (req,res) => {
  const [sessions,users,logs,alerts]=await Promise.all([
    query('SELECT COUNT(*) FROM sessions WHERE is_active AND expires_at>NOW()'),query('SELECT COUNT(*) FROM users WHERE is_active'),
    query("SELECT COUNT(*) FROM ip_logs WHERE flagged AND created_at>NOW()-INTERVAL '24 hours'"),query('SELECT COUNT(*) FROM anomaly_alerts WHERE resolved=FALSE'),
  ]);
  res.json({ activeSessions:Number(sessions.rows[0].count),totalUsers:Number(users.rows[0].count),flaggedLogs24h:Number(logs.rows[0].count),unresolvedAlerts:Number(alerts.rows[0].count) });
}));
module.exports=router;
