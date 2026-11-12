'use strict';
// Reproducible OpenAPI 3.1 source. No hosted service or generated credentials.
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const uuid={ type:'string',format:'uuid' };
const string=(maxLength,minLength=1) => ({ type:'string',minLength,maxLength });
const object=(properties,required=Object.keys(properties)) => ({ type:'object',additionalProperties:false,properties,required });
const ref=name => ({ $ref:`#/components/schemas/${name}` });
const platforms={ type:'string',enum:['windows','linux','macos','android'] };
const severity={ type:'string',enum:['low','medium','high','critical'] };
const registration=object({ username:{ ...string(80,3),pattern:'^[a-zA-Z0-9]+$' },email:{ type:'string',format:'email',maxLength:255 },
  password:{ ...string(72,12),pattern:'^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])',description:'At most 72 UTF-8 bytes; no bcrypt truncation.' },deviceId:string(255) },['username','email','password']);
const policy=object({ name:string(160),rules:object({ deny:{ type:'array',maxItems:100,items:string(500) },allow:{ type:'array',maxItems:100,items:string(500) } }),isActive:{ type:'boolean',default:true } },['name','rules']);
const schema={
  Error:require('../contracts/http.schema.json').$defs.apiError,
  Registration:registration,
  Login:require('../contracts/http.schema.json').$defs.loginRequest,
  Refresh:object({ refreshToken:string(4096) }),
  DeviceRegistration:object({ externalId:string(255),name:string(160),platform:platforms }),
  Policy:policy,
  PolicyUpdate:{ ...policy,properties:{ ...policy.properties,revision:{ type:'integer',minimum:1,maximum:2147483646 } },required:['name','rules','revision'] },
  Evaluation:object({ url:{ type:'string',format:'uri',maxLength:8192,description:'HTTP(S) only; URL userinfo is rejected.' } }),
  Event:object({ clientEventId:uuid,deviceId:uuid,eventType:{ ...string(80),pattern:'^[a-z][a-z0-9_.-]{0,79}$' },severity,occurredAt:{ type:'string',format:'date-time',description:'No older than seven days, no more than five minutes in future.' } },['clientEventId','eventType','severity','occurredAt']),
  SessionResult:{ type:'object',required:['user','accessToken','refreshToken','expiresAt'],properties:{ user:{ type:'object',properties:{ id:uuid,username:string(80),role:{ enum:['user','admin','superadmin'] },organizationId:uuid } },accessToken:{ type:'string' },refreshToken:{ type:'string' },expiresAt:{ type:'string',format:'date-time' } } },
};
const doc={ openapi:'3.1.0',info:{ title:'RemoteShield X control plane',version:'1.0.0',description:'Tenant-scoped modular monolith. Source-address filtering applies to protected APIs. Control decisions do not route traffic. See docs/MIGRATION_PHASE04.md. /api aliases /api/v1; no sunset date is scheduled. Health/readiness are outside the namespace.' },
  servers:[{ url:'/api/v1' }],security:[{ bearerAuth:[] }],paths:{},components:{ securitySchemes:{ bearerAuth:{ type:'http',scheme:'bearer',bearerFormat:'JWT' } },schemas:schema } };
function operation(method,route,summary,{ input,output,status=200,publicRoute=false,admin=false,list=false,filters={} }={}) {
  const op={ operationId:method+'_'+route.replace(/[^a-zA-Z0-9]/g,'_'),summary,description:admin ? 'Requires a live organization admin/superadmin session. No cross-organization superadmin bypass.' : 'Data access is scoped to the authenticated organization; ownership rules apply.',
    responses:{ [status]:{ description:'Success',content:{ 'application/json':{ schema:output || { type:'object',additionalProperties:true } } } },
      default:{ description:'Error; includes server-owned X-Request-ID correlation. 400 validation, 401 authentication, 403 authorization, 404 invisible resource, 409 conflict, 429 limit, 500 internal, 503 readiness/capacity.',content:{ 'application/json':{ schema:ref('Error') } } } } };
  if (publicRoute) op.security=[];
  if (input) op.requestBody={ required:true,content:{ 'application/json':{ schema:typeof input==='string' ? ref(input) : input } } };
  const parameters=[];
  if (route.includes('{id}')) parameters.push({ name:'id',in:'path',required:true,schema:uuid });
  if (list) parameters.push({ name:'page',in:'query',schema:{ type:'integer',minimum:1,maximum:10000,default:1 } },{ name:'limit',in:'query',schema:{ type:'integer',minimum:1,maximum:100,default:50 } });
  for (const [name,value] of Object.entries(filters)) parameters.push({ name,in:'query',required:['url','q'].includes(name),schema:value });
  if (parameters.length) op.parameters=parameters;
  (doc.paths[route] ||= {})[method]=op;
}
operation('get','/meta','API metadata',{ publicRoute:true });
operation('post','/auth/register','Register in the default organization (deployment flag)',{ input:'Registration',output:ref('SessionResult'),status:201,publicRoute:true });
operation('post','/auth/login','Login (organizationId optional for legacy organization)',{ input:'Login',output:ref('SessionResult'),publicRoute:true });
operation('post','/auth/refresh','Rotate a stored single-use refresh credential',{ input:'Refresh',output:ref('SessionResult'),publicRoute:true });
operation('post','/auth/logout','Revoke access and refresh session');
operation('get','/organization','Current organization');
operation('post','/users','Register an ordinary user in the admin organization',{ input:'Registration',admin:true,status:201 });
operation('get','/devices','List own devices; admins list organization devices',{ list:true,filters:{ status:{ enum:['registered','revoked'] } } });
operation('post','/devices','Register own device; this is not device attestation',{ input:'DeviceRegistration',status:201 });
operation('delete','/devices/{id}','Revoke own or admin-visible device and associated sessions');
operation('get','/sessions','List own sessions; admins list organization sessions',{ list:true,filters:{ active:{ type:'boolean' } } });
operation('delete','/sessions/{id}','Revoke own or admin-visible session');
operation('get','/policies','List organization policy revisions',{ list:true });
operation('post','/policies','Create policy',{ input:'Policy',status:201,admin:true });
operation('put','/policies/{id}','Update policy using expected revision',{ input:'PolicyUpdate',admin:true });
operation('post','/policies/evaluate','Evaluate active policy snapshot (deny wins)',{ input:'Evaluation' });
operation('post','/events','Ingest untrusted client event; idempotent per user/clientEventId',{ input:'Event',status:201 });
operation('get','/events','List organization security events',{ admin:true,list:true,filters:{ severity,eventType:{ type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}$' } } });
operation('post','/proxy/navigate','Legacy navigation decision and activity record',{ input:'Evaluation' });
operation('get','/proxy/check','Legacy URL decision with identical policy semantics',{ filters:{ url:{ type:'string',format:'uri',maxLength:8192 } } });
for (const route of ['sessions','users','blocked-urls','anomalies']) operation('get',`/admin/${route}`,`Legacy tenant ${route}`,{ admin:true,list:true });
operation('get','/admin/ip-logs','Tenant activity logs',{ admin:true,list:true,filters:{ flagged:{ type:'boolean' } } });
operation('get','/admin/stats','Tenant dashboard counts',{ admin:true });
operation('post','/admin/force-logout','Revoke sessions atomically with audit',{ admin:true,input:{ ...object({ userId:uuid,sessionId:uuid },[]),oneOf:[{ required:['userId'],not:{ required:['sessionId'] } },{ required:['sessionId'],not:{ required:['userId'] } }] } });
operation('post','/admin/blocked-urls','Upsert legacy tenant deny rule',{ admin:true,status:201,input:object({ pattern:string(500),reason:string(255) },['pattern']) });
operation('delete','/admin/blocked-urls/{id}','Deactivate legacy deny rule',{ admin:true });
operation('patch','/admin/anomalies/{id}/resolve','Resolve tenant anomaly',{ admin:true });
operation('patch','/admin/users/{id}/lock','Lock user and revoke sessions; unlock never revives old sessions',{ admin:true,input:object({ locked:{ type:'boolean' } }) });
operation('get','/laila/search','Public external search adapter',{ publicRoute:true,filters:{ q:{ type:'string',minLength:1,maxLength:500 } } });
for (const name of ['health','ready']) {
  operation('get',`/${name}`,name==='health' ? 'Process liveness' : 'Database role/schema readiness; 503 while draining',{ publicRoute:true });
  doc.paths[`/${name}`].get.servers=[{ url:'/' }];
}
fs.writeFileSync(path.join(root,'contracts/openapi.json'),JSON.stringify(doc,null,2)+'\n');
console.log(`Generated ${Object.keys(doc.paths).length} OpenAPI paths`);
