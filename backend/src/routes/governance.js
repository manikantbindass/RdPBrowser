'use strict';
const router=require('express').Router();
const rateLimit=require('express-rate-limit');
const { query,transaction }=require('../db/db');
const { Joi,validate,id,pagination,wrap,fail }=require('../services/validation');
const { change }=require('../services/governance-change');
const { managedUser }=require('../services/admin-roles');
const { entitlements }=require('../services/access-reviews');
const { exportPage,digest }=require('../services/evidence');
const target=req=>validate(id.required(),req.params.id);
const revision=Joi.number().integer().min(1).max(2147483646).required();
router.get('/governance/changes',wrap(async(req,res)=>{
  const {limit,offset,page}=pagination(req);
  res.json({ changes:(await query('SELECT * FROM governance_changes ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',[limit,offset])).rows,page,limit });
}));
router.post('/governance/exports',rateLimit({ windowMs:60000,max:10,standardHeaders:true,legacyHeaders:false }),wrap(async(req,res)=>res.json(await exportPage(req))));
router.get('/governance/device-compliance',wrap(async(req,res)=>{
  const {limit,offset,page}=pagination(req);
  const devices=(await query(`SELECT id,user_id,name,platform,status,trust_state,posture_valid_until,(public_key IS NOT NULL) AS key_enrolled,
    CASE WHEN status='revoked' OR trust_state='revoked' THEN 'revoked' WHEN trust_state='quarantined' THEN 'noncompliant'
      WHEN trust_state='approved' AND public_key IS NOT NULL AND posture_valid_until>NOW() THEN 'operator_approved'
      WHEN trust_state='approved' THEN 'stale' ELSE 'unknown' END AS compliance
    FROM devices ORDER BY created_at DESC,id LIMIT $1 OFFSET $2`,[limit,offset])).rows;
  res.json({ devices,page,limit,provenance:'Operator posture and server registry only; no MDM/hardware attestation.' });
}));
router.get('/governance/reviews',wrap(async(req,res)=>{
  const {limit,offset,page}=pagination(req);
  res.json({ reviews:(await query(`SELECT r.*,(SELECT COUNT(*)::int FROM access_review_items i WHERE i.review_id=r.id) AS item_count,
    (SELECT COUNT(*)::int FROM access_review_items i WHERE i.review_id=r.id AND decision='pending') AS pending_count
    FROM access_reviews r ORDER BY created_at DESC,id LIMIT $1 OFFSET $2`,[limit,offset])).rows,page,limit });
}));
router.post('/governance/reviews',wrap(async(req,res)=>{
  const value=validate(Joi.object({ name:Joi.string().min(1).max(160).required(),dueAt:Joi.string().isoDate().required(),
    userIds:Joi.array().items(id).min(1).max(100).unique() }),req.body);
  if (new Date(value.dueAt)<Date.now() || new Date(value.dueAt)>Date.now()+90*86400000) fail(400,'Review due date must be within 90 days');
  const review=await transaction(async()=>{
    const users=(await query('SELECT id FROM users WHERE is_active AND ($1::uuid[] IS NULL OR id=ANY($1::uuid[])) ORDER BY id LIMIT 501',[value.userIds || null])).rows;
    if (value.userIds && users.length!==value.userIds.length) fail(400,'One or more review subjects are unavailable','REVIEW_SUBJECT_UNAVAILABLE');
    if (users.length>500) fail(400,'Choose a bounded set of active users for this review','REVIEW_CAPACITY_EXCEEDED');
    const snapshots=await entitlements(users.map(user=>user.id));
    const row=(await query('INSERT INTO access_reviews(name,due_at,created_by) VALUES($1,$2,$3) RETURNING *',[value.name,value.dueAt,req.user.sub])).rows[0];
    for (const item of snapshots) await query('INSERT INTO access_review_items(review_id,user_id,snapshot) VALUES($1,$2,$3)',[row.id,item.id,item.snapshot]);
    await change(req,'review.create',row.id,null,{ name:row.name,users:snapshots.length });return row;
  });res.status(201).json({ review });
}));
async function review(req,lock=false) {
  const row=(await query('SELECT * FROM access_reviews WHERE id=$1'+(lock ? ' FOR UPDATE' : ''),[target(req)])).rows[0];
  if (!row) fail(404,'Review not found');return row;
}
router.get('/governance/reviews/:id/items',wrap(async(req,res)=>{
  await review(req);const {limit,offset,page}=pagination(req);
  res.json({ items:(await query('SELECT * FROM access_review_items WHERE review_id=$1 ORDER BY user_id,id LIMIT $2 OFFSET $3',[target(req),limit,offset])).rows,page,limit });
}));
router.post('/governance/reviews/:id/close',wrap(async(req,res)=>{
  const value=validate(Joi.object({ revision }),req.body);
  const result=await transaction(async()=>{
    const row=await review(req,true);
    if (row.revision!==value.revision || row.status!=='open') fail(409,'Review revision or state changed');
    if ((await query("SELECT 1 FROM access_review_items WHERE review_id=$1 AND decision='pending' LIMIT 1",[row.id])).rowCount) fail(409,'Pending items must be reviewed');
    const updated=(await query("UPDATE access_reviews SET status='closed',closed_by=$2,closed_at=NOW(),revision=revision+1 WHERE id=$1 RETURNING *",[row.id,req.user.sub])).rows[0];
    await change(req,'review.close',row.id,{ status:'open' },{ status:'closed' });return updated;
  });res.json({ review:result });
}));
for (const refresh of [false,true]) router[refresh ? 'post' : 'patch']('/governance/reviews/:id/items/:itemId'+(refresh ? '/refresh' : ''),wrap(async(req,res)=>{
  const value=validate(Joi.object({ revision,...(!refresh ? { decision:Joi.string().valid('retain','revoke').required(),reason:Joi.string().valid('access_required','no_longer_needed','followup_required').required() } : {}) }),req.body);
  const item=await transaction(async()=>{
    const campaign=await review(req,true);if (campaign.status!=='open') fail(409,'Review is closed');
    const old=(await query('SELECT * FROM access_review_items WHERE id=$1 AND review_id=$2 FOR UPDATE',[validate(id.required(),req.params.itemId),campaign.id])).rows[0];
    if (!old) fail(404,'Review item not found');if (old.revision!==value.revision) fail(409,'Item revision conflict');
    if (!refresh && old.user_id===req.user.sub) fail(403,'Independent review is required; administrators cannot approve their own access','SELF_REVIEW_DENIED');
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[old.user_id]);
    const current=(await entitlements([old.user_id]))[0];if (!current) fail(409,'Subject unavailable');
    if (refresh) {
      const updated=(await query(`UPDATE access_review_items SET snapshot=$2,snapshot_at=NOW(),decision='pending',reason=NULL,reviewed_by=NULL,reviewed_at=NULL,revision=revision+1 WHERE id=$1 RETURNING *`,[old.id,current.snapshot])).rows[0];
      await change(req,'review.refresh',old.id,{ snapshotDigest:digest(old.snapshot) },{ snapshotDigest:digest(current.snapshot) });return updated;
    }
    if (digest(current.snapshot)!==digest(old.snapshot)) fail(409,'Entitlements changed; refresh the item before reviewing','REVIEW_SNAPSHOT_STALE');
    if (value.decision==='revoke') {
      await managedUser(req.user,old.user_id);
      // A provisioning retry may restore active, but cannot clear an operator lock.
      await query('UPDATE users SET is_active=FALSE,is_locked=TRUE,scim_version=scim_version+1,updated_at=NOW() WHERE id=$1',[old.user_id]);
      await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1',[old.user_id]);
    }
    const updated=(await query('UPDATE access_review_items SET decision=$2,reason=$3,reviewed_by=$4,reviewed_at=NOW(),revision=revision+1 WHERE id=$1 RETURNING *',[old.id,value.decision,value.reason,req.user.sub])).rows[0];
    await query('INSERT INTO access_review_decisions(item_id,review_id,snapshot,snapshot_at,decision,reason,actor_id,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[old.id,campaign.id,old.snapshot,old.snapshot_at,value.decision,value.reason,req.user.sub,updated.revision]);
    await change(req,'review.'+value.decision,old.id,{ decision:old.decision },{ reviewId:campaign.id,decision:value.decision,reason:value.reason,subjectId:old.user_id });return updated;
  });res.json({ item });
}));
module.exports=router;
