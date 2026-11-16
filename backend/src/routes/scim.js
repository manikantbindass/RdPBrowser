'use strict';
const express=require('express');
const bcrypt=require('bcryptjs');
const { randomBytes }=require('node:crypto');
const rateLimit=require('express-rate-limit');
const router=express.Router({ mergeParams:true });
const { query }=require('../db/db');
const { withTenant,uuid,tenantId }=require('../db/tenant');
const { hashToken }=require('../services/sessions');
const { wrap,validate,id,fail }=require('../services/validation');
const { change }=require('../services/governance-change');
const { digest }=require('../services/evidence');
const { provisionMutation,members,replaceMembers,applyRoles }=require('../services/directory');
const S=require('../services/scim-schema');
router.use((req,res,next)=>{ res.type('application/scim+json');res.set('Cache-Control','no-store');next(); });
router.use(rateLimit({ windowMs:60000,max:(req)=>req.app.locals.config.SCIM_RATE_LIMIT_MAX,standardHeaders:true,legacyHeaders:false,
  handler:(req,res,next)=>next(Object.assign(new Error('SCIM request limit'),{ status:429,publicMessage:'SCIM request limit exceeded' })) }));
router.use(wrap(async(req,res,next)=>{
  const config=req.app.locals.config;
  if (!config.SCIM_ENABLED) fail(404,'Provisioning is disabled');
  if (config.NODE_ENV==='production' && !req.secure) fail(400,'HTTPS required');
  const organizationId=req.params.organizationId;
  const token=/^Bearer (rsx_scim\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
  if (!uuid.test(organizationId || '') || !token || token[2]!==organizationId || !uuid.test(token[3])) fail(401,'Invalid provisioning credential');
  await withTenant(organizationId,async()=>{
    const credential=(await query(`SELECT c.id,c.directory_id FROM provisioning_credentials c
      JOIN directory_connections d ON d.id=c.directory_id AND d.organization_id=c.organization_id
      JOIN organizations o ON o.id=c.organization_id WHERE c.id=$1 AND c.token_hash=$2
      AND c.revoked_at IS NULL AND c.expires_at>NOW() AND d.is_active AND o.is_active`,[token[3],hashToken(token[1])])).rows[0];
    if (!credential) fail(401,'Invalid provisioning credential');
    req.provisioning={ credentialId:credential.id,directoryId:credential.directory_id };
    await query('UPDATE provisioning_credentials SET last_used_at=NOW() WHERE id=$1',[credential.id]);
    next();
  });
}));
router.use(express.json({ type:['application/json','application/scim+json'],limit:'32kb' }));
const location=(req,kind,resourceId)=>(req.app.locals.config.SCIM_PUBLIC_BASE_URL || '/scim/v2')+'/'+tenantId()+'/'+kind+'/'+resourceId;
const etag=version=>`W/"${version}"`;
function userResource(req,row,groups=[]) {
  return { schemas:[S.USER],id:row.id,...(row.scim_external_id ? { externalId:row.scim_external_id } : {}),
    userName:row.username,active:row.is_active,displayName:row.scim_display_name || row.username,name:row.scim_name,
    emails:row.scim_emails,groups:groups.map(value=>({ value,type:'direct' })),
    meta:{ resourceType:'User',created:row.created_at,lastModified:row.updated_at,version:etag(row.scim_version),location:location(req,'Users',row.id) } };
}
async function resource(req,kind,row) {
  if (kind==='Users') {
    if (req.query.excludedAttributes==='groups') { const value=userResource(req,row);delete value.groups;return value; }
    const groups=(await query('SELECT m.group_id FROM directory_members m JOIN directory_groups g ON g.id=m.group_id AND g.organization_id=m.organization_id WHERE m.user_id=$1 AND NOT g.is_deleted ORDER BY m.group_id',[row.id])).rows.map(r=>r.group_id);
    return userResource(req,row,groups);
  }
  const values=req.query.excludedAttributes==='members' ? null : await members(row.id);
  return { schemas:[S.GROUP],id:row.id,...(row.external_id ? { externalId:row.external_id } : {}),displayName:row.display_name,
    ...(values && { members:values.map(value=>({ value })) }),meta:{ resourceType:'Group',created:row.created_at,lastModified:row.updated_at,version:etag(row.revision),location:location(req,'Groups',row.id) } };
}
async function get(req,kind,lock=false,includeDeleted=false) {
  const target=validate(id.required(),req.params.id);
  const row=(await query(`SELECT * FROM ${kind==='Users' ? 'users' : 'directory_groups'} WHERE id=$1 AND directory_id=$2
    ${includeDeleted ? '' : kind==='Users' ? 'AND scim_deleted_at IS NULL' : 'AND NOT is_deleted'} ${lock ? 'FOR UPDATE' : ''}`,[target,req.provisioning.directoryId])).rows[0];
  if (!row) fail(404,'Resource not found');
  return row;
}
async function send(req,res,kind,row,status=200) {
  res.set('ETag',etag(kind==='Users' ? row.scim_version : row.revision));res.location(location(req,kind,row.id));
  res.status(status).json(await resource(req,kind,row));
}
router.get('/ServiceProviderConfig',(req,res)=>res.json({ schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  patch:{ supported:true },bulk:{ supported:false,maxOperations:0,maxPayloadSize:0 },filter:{ supported:true,maxResults:100 },
  changePassword:{ supported:false },sort:{ supported:false },etag:{ supported:true },
  authenticationSchemes:[{ type:'httpbearer',name:'Scoped bearer credential',description:'Revocable directory-scoped provisioning credential',primary:true }] }));
const schemaResources=[{ id:S.USER,name:'User',attributes:[
  { name:'userName',type:'string',required:true,mutability:'readWrite',caseExact:false,uniqueness:'server',multiValued:false },
  { name:'active',type:'boolean',required:false,mutability:'readWrite',multiValued:false },
  { name:'displayName',type:'string',required:false,mutability:'readWrite',multiValued:false },
  { name:'name',type:'complex',required:false,mutability:'readWrite',multiValued:false },
  { name:'emails',type:'complex',required:true,mutability:'readWrite',multiValued:true },
  { name:'groups',type:'complex',required:false,mutability:'readOnly',multiValued:true },
] },{ id:S.GROUP,name:'Group',attributes:[{ name:'displayName',type:'string',required:true,mutability:'readWrite',multiValued:false },
  { name:'members',type:'complex',required:false,mutability:'readWrite',multiValued:true }] }]
  .map(value=>({ schemas:['urn:ietf:params:scim:schemas:core:2.0:Schema'],...value }));
const listResponse=rows=>({ schemas:[S.LIST],totalResults:rows.length,startIndex:1,itemsPerPage:rows.length,Resources:rows });
router.get('/Schemas',(req,res)=>res.json(listResponse(schemaResources)));
router.get('/Schemas/:schema',(req,res)=>{ const schema=schemaResources.find(s=>s.id===req.params.schema);if (!schema) fail(404,'Schema not found');res.json(schema); });
router.get('/ResourceTypes',(req,res)=>res.json(listResponse(['Users','Groups'].map((kind,i)=>({ schemas:['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],id:kind.slice(0,-1),name:kind.slice(0,-1),endpoint:'/'+kind,schema:i===0 ? S.USER : S.GROUP,schemaExtensions:[] })))));

for (const kind of ['Users','Groups']) {
  router.get('/'+kind,wrap(async(req,res)=>{
    const { start,count,offset }=S.paging(req.query),filter=S.filter(req.query.filter,kind);
    const table=kind==='Users' ? 'users' : 'directory_groups';
    const where=`directory_id=$1 AND ${kind==='Users' ? 'scim_deleted_at IS NULL' : 'NOT is_deleted'}${filter ? ` AND ${filter.fold ? `lower(${filter.column}::text)=lower($2)` : `${filter.column}::text=$2`}` : ''}`;
    const params=[req.provisioning.directoryId,...(filter ? [filter.term] : [])];
    const total=Number((await query(`SELECT COUNT(*) FROM ${table} WHERE ${where}`,params)).rows[0].count);
    const rows=(await query(`SELECT * FROM ${table} WHERE ${where} ORDER BY id LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,count,offset])).rows;
    res.json({ schemas:[S.LIST],totalResults:total,startIndex:start,itemsPerPage:rows.length,Resources:await Promise.all(rows.map(row=>resource(req,kind,row))) });
  }));
  router.get('/'+kind+'/:id',wrap(async(req,res)=>{
    if (Object.keys(req.query).some(key=>key!=='excludedAttributes')) fail(400,'Unsupported attribute query','invalidValue');
    S.paging(req.query);
    await send(req,res,kind,await get(req,kind));
  }));
  router.post('/'+kind,wrap(async(req,res)=>{
    const value=kind==='Users' ? S.userValue(req.body) : S.groupValue(req.body);
    if (value.id) fail(400,'Client cannot set a resource ID','mutability');
    const password=kind==='Users' ? await bcrypt.hash(randomBytes(48).toString('base64url'),12) : null;
    const row=await provisionMutation(req,async()=>{
      let inserted;
      if (kind==='Users') {
        if ((await query('SELECT id FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($2)',[value.userName,(value.emails.find(v=>v.primary) || value.emails[0]).value])).rowCount) fail(409,'Existing accounts cannot be adopted by provisioning','uniqueness');
        inserted=(await query(`INSERT INTO users(directory_id,username,email,password_hash,is_active,scim_external_id,scim_display_name,scim_name,scim_emails,password_auth_enabled)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE) RETURNING *`,[req.provisioning.directoryId,value.userName,(value.emails.find(v=>v.primary) || value.emails[0]).value.toLowerCase(),password,value.active,value.externalId || null,value.displayName || null,value.name,JSON.stringify(value.emails)])).rows[0];
      } else {
        inserted=(await query('INSERT INTO directory_groups(directory_id,display_name,external_id) VALUES($1,$2,$3) RETURNING *',[req.provisioning.directoryId,value.displayName,value.externalId || null])).rows[0];
        await replaceMembers(req,inserted,value.members);
      }
      await change(req,kind==='Users' ? 'scim.user_create' : 'scim.group_create',inserted.id,null,{ directoryId:req.provisioning.directoryId,active:value.active });
      return inserted;
    });
    await send(req,res,kind,row,201);
  }));
  for (const method of ['put','patch']) router[method]('/'+kind+'/:id',wrap(async(req,res)=>{
    if (Object.keys(req.query).length) fail(400,'Unexpected mutation query','invalidValue');
    const row=await provisionMutation(req,async()=>{
      const current=await get(req,kind,true);
      S.precondition(req,kind==='Users' ? current.scim_version : current.revision);
      const existing=await resource(req,kind,current);
      // Omit potentially large read-only memberships from a User replacement.
      if (kind==='Users') delete existing.groups;
      const body=method==='put' ? {
        ...(existing.externalId && { externalId:existing.externalId }),
        ...(kind==='Users' && { active:existing.active }),
        ...req.body,
      } : patchResource(kind,existing,S.operations(req.body));
      const value=kind==='Users' ? S.userValue(body) : S.groupValue(body);
      if (value.id && value.id!==current.id) fail(400,'Resource ID is immutable','mutability');
      if ((value.externalId || null)!==(kind==='Users' ? current.scim_external_id : current.external_id)) fail(400,'External identity is immutable; create a new resource','mutability');
      let updated;
      if (kind==='Users') {
        if ((await query('SELECT id FROM users WHERE id<>$1 AND (lower(username)=lower($2) OR lower(email)=lower($3))',[current.id,value.userName,(value.emails.find(v=>v.primary) || value.emails[0]).value])).rowCount) fail(409,'Existing accounts cannot be adopted by provisioning','uniqueness');
        updated=(await query(`UPDATE users SET username=$2,email=$3,is_active=$4,scim_display_name=$5,scim_name=$6,scim_emails=$7,
          scim_version=scim_version+1,updated_at=NOW() WHERE id=$1 RETURNING *`,[current.id,value.userName,(value.emails.find(v=>v.primary) || value.emails[0]).value.toLowerCase(),value.active,value.displayName || null,value.name,JSON.stringify(value.emails)])).rows[0];
        if (current.is_active!==value.active || current.username!==value.userName || digest(current.scim_emails)!==digest(value.emails)) await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1',[current.id]);
      } else {
        updated=(await query('UPDATE directory_groups SET display_name=$2,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *',[current.id,value.displayName])).rows[0];
        await replaceMembers(req,updated,value.members);
      }
      await change(req,kind==='Users' ? 'scim.user_update' : 'scim.group_update',current.id,{ active:current.is_active,version:current.scim_version || current.revision },{ active:value.active,version:updated.scim_version || updated.revision });
      return updated;
    });
    await send(req,res,kind,row);
  }));
  router.delete('/'+kind+'/:id',wrap(async(req,res)=>{
    await provisionMutation(req,async()=>{
      const row=await get(req,kind,true,true);
      S.precondition(req,kind==='Users' ? row.scim_version : row.revision);
      if (kind==='Users') {
        if (row.scim_deleted_at) return;
        await query('UPDATE directory_groups SET revision=revision+1,updated_at=NOW() WHERE id IN(SELECT group_id FROM directory_members WHERE user_id=$1)',[row.id]);
        await query('DELETE FROM directory_members WHERE user_id=$1',[row.id]);
        await query('UPDATE users SET is_active=FALSE,scim_deleted_at=NOW(),scim_version=scim_version+1,updated_at=NOW() WHERE id=$1',[row.id]);
        await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=$1',[row.id]);
      } else {
        if (row.is_deleted) return;
        const affected=await members(row.id);
        await query('DELETE FROM directory_members WHERE group_id=$1',[row.id]);
        await query('UPDATE directory_groups SET is_deleted=TRUE,mapped_role=\'user\',revision=revision+1,updated_at=NOW() WHERE id=$1',[row.id]);
        await applyRoles(affected);
      }
      await change(req,kind==='Users' ? 'scim.user_delete' : 'scim.group_delete',row.id,null,{ softDeleted:true });
    });
    res.status(204).end();
  }));
}
function patchResource(kind,existing,operations) {
  const result=structuredClone(existing);
  for (const operation of operations) {
    const op=operation.op.toLowerCase(),path=operation.path?.toLowerCase();
    if (!path) {
      if (!operation.value || typeof operation.value!=='object' || Array.isArray(operation.value) || op==='remove') fail(400,'Invalid pathless operation','invalidPath');
      const nested=Object.entries(operation.value).map(([path,value])=>({ op:operation.op,path,value }));
      if (nested.some(entry=>!entry.path)) fail(400,'Invalid attribute name','invalidPath');
      Object.assign(result,patchResource(kind,result,nested));continue;
    }
    if (kind==='Groups' && path.startsWith('members')) {
      const selector=/^members\[value eq "([0-9a-f-]{36})"\]$/.exec(path);
      if (path!=='members' && !selector) fail(400,'Unsupported member path','invalidPath');
      if (selector && op!=='remove') fail(400,'Member value selectors support removal','invalidPath');
      if (op==='remove') {
        const remove=selector ? [selector[1]] : operation.value===undefined ? result.members.map(m=>m.value) : validateMembers(operation.value).map(m=>m.value);
        result.members=result.members.filter(m=>!remove.includes(m.value));
      } else {
        const values=validateMembers(operation.value);
        result.members=op==='replace' ? values : [...new Map([...result.members,...values].map(m=>[m.value,m])).values()];
      }
      continue;
    }
    const names=kind==='Users' ? { username:'userName',active:'active',displayname:'displayName',externalid:'externalId',name:'name',emails:'emails' } : { displayname:'displayName',externalid:'externalId' };
    if (names[path]) {
      if (op==='remove') { if (!['displayname','name'].includes(path)) fail(400,'Required or immutable attribute cannot be removed','mutability');delete result[names[path]]; }
      else result[names[path]]=path==='active' && ['true','false'].includes(operation.value) ? operation.value==='true' : operation.value;
    } else if (kind==='Users' && /^name\.(givenname|familyname|middlename|formatted|honorificprefix|honorificsuffix)$/.test(path)) {
      const canonical={ givenname:'givenName',familyname:'familyName',middlename:'middleName',formatted:'formatted',honorificprefix:'honorificPrefix',honorificsuffix:'honorificSuffix' }[path.split('.')[1]];
      result.name ||= {}; if (op==='remove') delete result.name[canonical];else result.name[canonical]=operation.value;
    } else if (kind==='Users' && path==='emails[type eq "work"].value' && op!=='remove') {
      const work=result.emails.find(email=>email.type==='work');if (!work) result.emails.push({ type:'work',value:operation.value });else work.value=operation.value;
    } else fail(400,'Unsupported or read-only attribute path','invalidPath');
  }
  return result;
}
function validateMembers(value) {
  if (!Array.isArray(value)) fail(400,'Group members must be an array','invalidValue');
  return S.groupValue({ schemas:[S.GROUP],displayName:'validation',members:value }).members;
}
router.use((req,res,next)=>next(Object.assign(new Error('Unsupported SCIM operation'),{ status:404,publicMessage:'SCIM operation not supported' })));
router.use((err,req,res,next)=>{
  if (res.headersSent) return next(err);
  const status=err.code==='23505' ? 409 : ['23503','23514','22P02'].includes(err.code) ? 400 : err.status || 500;
  if (status===401) res.set('WWW-Authenticate','Bearer realm="RemoteShield SCIM"');
  req.app.get('logger')?.warn({ event:'scim.failed',requestId:req.requestId,status });
  res.status(status).type('application/scim+json').json({ schemas:['urn:ietf:params:scim:api:messages:2.0:Error'],status:String(status),
    ...(err.code==='23505' ? { scimType:'uniqueness' } : ['invalidFilter','invalidValue','invalidPath','mutability','invalidVers'].includes(err.code) ? { scimType:err.code } : {}),
    detail:status>=500 ? 'Provisioning unavailable' : err.code==='23505' ? 'Resource already exists' : err.publicMessage || 'Request validation failed',requestId:req.requestId });
});
module.exports=router;
module.exports.patchResource=patchResource;
