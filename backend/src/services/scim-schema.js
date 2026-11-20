'use strict';
const { Joi,validate,fail,id } = require('./validation');
const USER='urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP='urn:ietf:params:scim:schemas:core:2.0:Group';
const PATCH='urn:ietf:params:scim:api:messages:2.0:PatchOp';
const LIST='urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ENTRA_USER='urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const ENTRA_GROUP='http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group';
const text = max => Joi.string().min(1).max(max).custom((value,helpers)=>
  [...value].some(c=>c.codePointAt(0)<32 || c.codePointAt(0)===127) ? helpers.error('any.invalid') : value);
const inputSchemas=(core,extension)=>Joi.array().items(Joi.string().valid(core,extension)).has(Joi.string().valid(core)).unique().max(2).required();
const userSchema=Joi.object({ schemas:inputSchemas(USER,ENTRA_USER),
  id,meta:Joi.object(),groups:Joi.array().max(1000),userName:text(80).required(),externalId:text(255),active:Joi.boolean().default(true),
  // Common provider-supplied optional attributes are accepted without storage or authority.
  locale:text(64),password:Joi.string().max(1024),addresses:Joi.array().max(10).allow(null),[ENTRA_USER]:Joi.object(),
  displayName:text(160),name:Joi.object({ givenName:text(160),familyName:text(160),middleName:text(160),formatted:text(255),honorificPrefix:text(32),honorificSuffix:text(32) }).default({}),
  emails:Joi.array().min(1).max(10).items(Joi.object({ value:Joi.string().email({ tlds:{ allow:false } }).max(255).required(),type:text(32),primary:Joi.boolean() })).required(),
});
const members=Joi.array().max(200).items(Joi.object({ value:id.required(),display:text(160),type:Joi.string().valid('User'),$ref:Joi.string().max(2048) }));
const groupSchema=Joi.object({ schemas:inputSchemas(GROUP,ENTRA_GROUP),id,meta:Joi.object(),
  displayName:text(160).required(),externalId:text(255),members:members.default([]) });
function userValue(body) {
  const value=validate(userSchema,body);
  if (value.emails.filter(email => email.primary).length>1) fail(400,'Only one primary email is supported','invalidValue');
  return value;
}
function groupValue(body) { return validate(groupSchema,body); }
function paging(query) {
  for (const key of Object.keys(query)) if (!['startIndex','count','filter','excludedAttributes'].includes(key)) fail(400,'Unsupported SCIM query','invalidFilter');
  if (query.excludedAttributes!==undefined && !['members','groups'].includes(query.excludedAttributes)) fail(400,'Unsupported attribute exclusion','invalidValue');
  for (const value of [query.startIndex,query.count]) if (value!==undefined && (typeof value!=='string' || !/^\d{1,7}$/.test(value))) fail(400,'Invalid pagination','invalidValue');
  const start=Number(query.startIndex ?? 1),count=Number(query.count ?? 100);
  if (start<1 || start>1000000 || count<0 || count>100) fail(400,'SCIM pagination out of range','invalidValue');
  return { start,count,offset:start-1 };
}
function filter(value,kind) {
  if (value===undefined) return null;
  if (typeof value!=='string' || value.length>600) fail(400,'Invalid filter','invalidFilter');
  const match=/^(userName|externalId|id|displayName)\s+eq\s+("(?:[^"\\]|\\["\\])*")$/i.exec(value);
  if (!match) fail(400,'Only supported-attribute equality filters are implemented','invalidFilter');
  const attribute=match[1].toLowerCase();
  const columns=kind==='Users' ? userFilterColumns : groupFilterColumns;
  const column=columns.get(attribute);
  if (!column) fail(400,'Unsupported filter attribute','invalidFilter');
  const term=JSON.parse(match[2]);
  if (attribute==='id') validate(id.required(),term);
  return { column,term,fold:['username','displayname'].includes(attribute) };
}
const userFilterColumns=new Map([['username','username'],['externalid','scim_external_id'],['id','id']]);
const groupFilterColumns=new Map([['displayname','display_name'],['externalid','external_id'],['id','id']]);
function operations(body) {
  return validate(Joi.object({ schemas:Joi.array().items(Joi.string().valid(PATCH)).length(1).required(),
    Operations:Joi.array().min(1).max(50).items(Joi.object({ op:Joi.string().valid('add','Add','replace','Replace','remove','Remove').required(),path:Joi.string().min(1).max(400),value:Joi.any() })).required() }),body).Operations;
}
function precondition(req,version) {
  if (req.headers['if-match'] && req.headers['if-match']!==`W/"${version}"` && req.headers['if-match']!=='*') fail(412,'Resource version changed','invalidVers');
}
module.exports={ USER,GROUP,PATCH,LIST,userValue,groupValue,paging,filter,operations,precondition };
