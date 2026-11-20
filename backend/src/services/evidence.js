'use strict';
const { createHash,createHmac,timingSafeEqual,randomUUID }=require('node:crypto');
const { query,transaction }=require('../db/db');
const { tenantId }=require('../db/tenant');
const { Joi,validate,fail }=require('./validation');
const { change }=require('./governance-change');
function canonical(value) {
  if (value instanceof Date) return JSON.stringify(value.toJSON());
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') {
    const entries=Object.entries(value).sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0);
    return '{'+entries.map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
  }
  return JSON.stringify(value);
}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const datasets=Object.freeze({
  audit:{ table:'audit_log',columns:'id,actor_id,actor_kind,provisioning_credential_id,action,target,request_id,created_at' },
  changes:{ table:'governance_changes',columns:'id,actor_id,provisioning_credential_id,action,target,before_state,after_state,request_id,created_at' },
  reviews:{ table:'access_review_decisions',columns:'id,review_id,item_id,snapshot,snapshot_at,decision,reason,actor_id,revision,created_at' },
  policy_versions:{ table:'policy_versions',columns:'policy_id,revision,name,rules,is_active,assignment,actor_id,created_at',key:"policy_id::text||':'||lpad(revision::text,10,'0')" },
  users:{ table:'users',columns:'id,username,role,is_active,is_locked,directory_id,created_at',inventory:true },
  devices:{ table:'devices',columns:'id,user_id,name,platform,status,trust_state,posture_valid_until,created_at',inventory:true },
});
function encodeCursor(value,secret) {
  const body=Buffer.from(JSON.stringify(value)).toString('base64url');
  return body+'.'+createHmac('sha256',secret).update('governance.export.v1:'+body).digest('hex');
}
function decodeCursor(token,secret,organizationId,dataset) {
  try {
    if (typeof token!=='string' || token.length>3000) throw new Error();
    const [body,mac,...extra]=token.split('.');
    if (extra.length || !/^[a-f0-9]{64}$/.test(mac)) throw new Error();
    const expected=createHmac('sha256',secret).update('governance.export.v1:'+body).digest();
    if (!timingSafeEqual(Buffer.from(mac,'hex'),expected)) throw new Error();
    const value=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if (value.version!==1 || value.organizationId!==organizationId || value.dataset!==dataset || value.expiresAt<Date.now()) throw new Error();
    return value;
  } catch { fail(400,'Invalid, expired or differently scoped evidence cursor','INVALID_EXPORT_CURSOR'); }
}
async function exportPage(req) {
  const value=validate(Joi.object({ dataset:Joi.string().valid(...Object.keys(datasets)).required(),limit:Joi.number().integer().min(1).max(500).default(100),
    from:Joi.string().isoDate(),to:Joi.string().isoDate(),cursor:Joi.string().max(3000) }),req.body);
  const spec=datasets[value.dataset];
  if (value.cursor && (value.from || value.to)) fail(400,'Cursor carries its existing selection');
  let selection;
  if (value.cursor) selection=decodeCursor(value.cursor,req.app.locals.config.JWT_SECRET,tenantId(),value.dataset);
  else {
    const asOf=new Date().toISOString();
    if (spec.inventory && (value.from || value.to)) fail(400,'Inventory exports represent current state, not historical state');
    const from=spec.inventory ? '1970-01-01T00:00:00Z' : value.from || new Date(Date.now()-30*86400000).toISOString();
    const to=value.to || asOf;
    if (new Date(from)>new Date(to) || new Date(to)>new Date(asOf) || (!spec.inventory && new Date(to)-new Date(from)>31*86400000)) fail(400,'Export window must be ordered, nonfuture and at most 31 days');
    selection={ version:1,organizationId:tenantId(),dataset:value.dataset,from,to,asOf,expiresAt:Date.now()+900000,after:null };
  }
  return transaction(async()=>{
    const key=spec.key || 'id::text';
    const result=await query(`SELECT ${spec.columns},created_at::text AS _time,${key} AS _key FROM ${spec.table}
      WHERE created_at>=$1 AND created_at<=$2 AND ($3::text IS NULL OR (created_at,${key})>($3::timestamptz,$4::text))
      ORDER BY created_at,${key} LIMIT $5`,[selection.from,selection.to,selection.after?.time || null,selection.after?.key || null,value.limit+1]);
    const more=result.rows.length>value.limit,selected=result.rows.slice(0,value.limit),last=selected[selected.length-1];
    const rows=selected.map(row=>{ const copy={...row};delete copy._time;delete copy._key;return copy; });
    const sha256=digest(rows),exportId=randomUUID();
    const criteria={ from:selection.from,to:selection.to,asOf:selection.asOf,after:selection.after,mode:spec.inventory ? 'current_inventory' : 'recorded_events' };
    await query('INSERT INTO evidence_exports(id,actor_id,dataset,digest,row_count,criteria) VALUES($1,$2,$3,$4,$5,$6)',[exportId,req.user.sub,value.dataset,sha256,rows.length,criteria]);
    await change(req,'governance.export',exportId,null,{ dataset:value.dataset,rowCount:rows.length,sha256 });
    return { manifest:{ version:1,exportId,organizationId:tenantId(),dataset:value.dataset,generatedAt:new Date().toISOString(),criteria,rowCount:rows.length,sha256,
      digestFormat:'SHA-256 of recursively key-sorted compact JSON rows; integrity record, not an external signature',privacy:'Confidential tenant evidence; usernames and device labels can contain personal information.' },rows,
    nextCursor:more ? encodeCursor({...selection,after:{ time:last._time,key:last._key }},req.app.locals.config.JWT_SECRET) : null };
  });
}
module.exports={ canonical,digest,datasets,encodeCursor,decodeCursor,exportPage };
