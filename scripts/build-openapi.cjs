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
operation('get','/auth/status','Own live session and device bootstrap status; does not grant content access');
operation('post','/auth/status','Own session plus bounded URL re-evaluation for native policy monitor',{input:object({urls:{type:'array',maxItems:20,items:{type:'string',format:'uri',maxLength:8192}}})});
const accessConfiguration=object({
  allowedRoles:{ type:'array',minItems:1,uniqueItems:true,items:{ enum:['user','admin','superadmin'] } },
  allowedAuthMethods:{ type:'array',minItems:1,uniqueItems:true,items:{ enum:['password','oidc'] } },
  requireMfa:{ type:'boolean' },highSensitivityRequireMfa:{ type:'boolean' },requireTrustedDevice:{ type:'boolean' },
  sessionMaxAgeSeconds:{ type:'integer',minimum:300,maximum:604800 },idleTimeoutSeconds:{ type:'integer',minimum:60,maximum:86400 },
  maxProofAgeSeconds:{ type:'integer',minimum:60,maximum:86400 },maxMfaAgeSeconds:{ type:'integer',minimum:60,maximum:86400 },
});
schema.AccessConfiguration=accessConfiguration;
operation('get','/admin/access-policy','Get effective organization access policy and revision',{ admin:true });
operation('put','/admin/access-policy','Replace access policy using expected revision; bootstrap safety checks apply',{ admin:true,input:object({ revision:{ type:'integer',minimum:0,maximum:2147483646 },configuration:ref('AccessConfiguration') }) });
operation('post','/admin/identity-links','Link a preexisting local user to exact operator-configured issuer/subject',{ admin:true,status:201,input:object({ userId:uuid,providerId:string(64),subject:string(255) }) });
operation('delete','/admin/identity-links/{id}','Unlink identity and revoke enterprise sessions',{ admin:true });
operation('get','/admin/access-decisions','List server-owned organization authorization decisions',{ admin:true,list:true });
operation('post','/access/evaluate','Evaluate a server-defined resource with live identity/session/device context',{ input:object({ resource:{ enum:['auth.login','session.terminate','device.enroll','session.manage','browser.navigate','events.ingest','admin.manage','realtime.connect'] } }) });
operation('post','/devices/{id}/key','Enroll an immutable owner P-256 public key; unknown trust until admin approval',{ status:201,input:object({ publicKey:object({ kty:{ const:'EC' },crv:{ const:'P-256' },x:{ type:'string',pattern:'^[A-Za-z0-9_-]{43}$' },y:{ type:'string',pattern:'^[A-Za-z0-9_-]{43}$' } }) }) });
operation('post','/devices/{id}/challenge','Issue session-bound one-use five-minute device possession challenge',{ status:201 });
operation('post','/devices/{id}/proof','Prove ECDSA-SHA256-DER key possession; this is not hardware attestation',{ input:object({ challengeId:uuid,nonce:{ type:'string',pattern:'^[A-Za-z0-9_-]{43}$' },signature:{ type:'string',pattern:'^[A-Za-z0-9_-]{80,120}$' } }) });
operation('patch','/admin/devices/{id}/trust','Update posture trust; revoked devices cannot be restored',{ admin:true,input:object({ trustState:{ enum:['unknown','approved','quarantined','revoked'] },validForSeconds:{ type:'integer',minimum:60,maximum:86400 },reason:{ enum:['operator_verified','noncompliant','compromised','review_required'] } },['trustState','reason']) });
operation('get','/auth/oidc/{provider}/start','Start browser-bound confidential OIDC authorization code flow',{ publicRoute:true,status:303 });
doc.paths['/auth/oidc/{provider}/start'].get.parameters=[{ name:'provider',in:'path',required:true,schema:{ type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$' } }];
doc.paths['/auth/oidc/{provider}/start'].get.responses['303']={ description:'Redirect to configured IdP; sets Secure/HttpOnly/SameSite=Lax browser-binding cookie. No tokens in URL.',headers:{ Location:{ schema:{ type:'string',format:'uri' } } } };
operation('get','/auth/oidc/{provider}/callback','Consume one-use state/code and issue local tokens only for an explicit identity link',{ publicRoute:true,output:ref('SessionResult') });
doc.paths['/auth/oidc/{provider}/callback'].get.parameters=[{ name:'provider',in:'path',required:true,schema:{ type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$' } },
  { name:'__Host-rsx_oidc',in:'cookie',required:true,schema:{ type:'string',pattern:'^[A-Za-z0-9_-]{43}$' } },
  { name:'state',in:'query',required:true,schema:{ type:'string',pattern:'^[A-Za-z0-9_-]{43}$' } },
  { name:'code',in:'query',schema:{ type:'string',maxLength:4096 },description:'Exactly one of code/error is required. Browser-binding cookie is required.' },
  { name:'error',in:'query',schema:{ type:'string',maxLength:100 } },{ name:'error_description',in:'query',schema:{ type:'string',maxLength:1000 } },
  { name:'iss',in:'query',schema:{ type:'string',format:'uri',maxLength:2048 } },{ name:'session_state',in:'query',schema:{ type:'string',maxLength:2048 } }];
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
