'use strict';
const { Pool }=require('pg');
const { randomUUID,createHash }=require('node:crypto');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const request=require('supertest');
const { migrate }=require('../src/db/migrations');
const { provision }=require('../src/db/provision');
const { DEFAULT_ORGANIZATION:orgA,withTenant }=require('../src/db/tenant');
const db=require('../src/db/db');
const { loadConfig }=require('../src/config');
const { createRuntime }=require('../src/runtime');
const { createApp }=require('../src/http/app');
const { onboard,offboard }=require('../src/services/organization-lifecycle');
const { digest }=require('../src/services/evidence');
const S=require('../src/services/scim-schema');
const url=process.env.INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated _test database required');
const suffix=randomUUID().replaceAll('-','');
const schema='gov_'+suffix,role='gov_role_'+suffix,roleSecret=randomUUID()+randomUUID(),orgB=randomUUID();
const owner=new Pool({ connectionString:url,connectionTimeoutMillis:5000,statement_timeout:15000 });
const scoped=new URL(url);scoped.searchParams.set('options','-c search_path='+schema+',public');
const restricted=new URL(scoped);restricted.username=role;restricted.password=roleSecret;
const config={ ...loadConfig({ NODE_ENV:'test',DATABASE_URL:restricted.toString(),JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),
  VPN_REQUIRED:'false',SCIM_ENABLED:'true',RATE_LIMIT_MAX:'10000',AUTH_RATE_LIMIT_MAX:'1000',MAX_SESSIONS_PER_USER:'10' }),PORT:0 };
const logs=[];const logger={ info:v=>logs.push(v),error:v=>logs.push(v),warn:v=>logs.push(v) };
let runtime,pool,root,rootToken,admin,adminToken,other,otherToken,local,localToken,dir,credential,secondary,member,group;
const api=(method,path,token,body)=>{
  const req=request(runtime.app)[method]('/api/v1'+path).auth(token,{ type:'bearer' });
  return body===undefined ? req : req.send(body);
};
const scim=(method,path,body,token=credential?.token,org=orgA)=>{
  const req=request(runtime.app)[method]('/scim/v2/'+org+path);
  if (token) req.auth(token,{ type:'bearer' });
  return body===undefined ? req : req.set('Content-Type','application/scim+json').send(body);
};
const makeUser=(name,extra={})=>({ schemas:[S.USER],userName:name,externalId:'ext-'+name,emails:[{ value:name+'@test.example',type:'work',primary:true }],...extra });
const patch=(...Operations)=>({ schemas:[S.PATCH],Operations });
async function login(username,organizationId=orgA) {
  const res=await request(runtime.app).post('/api/v1/auth/login').send({ username,organizationId,password:'TestPassword1!' });
  expect(res.status).toBe(200);return res.body.accessToken;
}
async function fixtureAccess(userId,organizationId=orgA) {
  const token=jwt.sign({ sub:userId,organizationId,type:'access',jti:randomUUID() },config.JWT_SECRET,{ expiresIn:'1h' });
  await pool.query(`INSERT INTO sessions(organization_id,user_id,token_hash,expires_at,authentication_method)
    VALUES($1,$2,$3,NOW()+INTERVAL '1 hour','oidc')`,[organizationId,userId,createHash('sha256').update(token).digest('hex')]);
  return token;
}
async function directory(name,token=rootToken) {
  const row=await api('post','/admin/integrations/directories',token,{ name });expect(row.status).toBe(201);return row.body.directory;
}
async function issue(directoryId,token=rootToken) {
  const row=await api('post','/admin/integrations/directories/'+directoryId+'/credentials',token,{ expiresInDays:30 });expect(row.status).toBe(201);return row.body;
}
beforeAll(async()=>{
  await owner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
  await owner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
  await owner.query(`CREATE SCHEMA ${schema}`);pool=new Pool({ connectionString:scoped.toString(),statement_timeout:15000 });
  await migrate(pool);await provision(pool,{ schema,role,password:roleSecret });
  const hash=await bcrypt.hash('TestPassword1!',4);
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[orgB,'Other tenant']);
  async function user(org,name,level) { return (await pool.query(`INSERT INTO users(organization_id,username,email,password_hash,role)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[org,name,name+'@test.example',hash,level])).rows[0].id; }
  root=await user(orgA,'superone','superadmin');admin=await user(orgA,'adminone','admin');local=await user(orgA,'localuser','user');other=await user(orgB,'othertenant','superadmin');
  runtime=createRuntime({ config,logger,database:db });await runtime.start();
  rootToken=await login('superone');adminToken=await login('adminone');localToken=await login('localuser');otherToken=await login('othertenant',orgB);
  dir=await directory('Okta fixture');credential=await issue(dir.id);const second=await directory('Second directory');secondary=await issue(second.id);
});
afterAll(async()=>{
  if (runtime) await runtime.stop();if (pool) await pool.end();
  try { await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.query(`DROP ROLE IF EXISTS ${role}`); }
  finally { await owner.end(); }
});
test('SCIM discovery is scoped, content type is correct and credential metadata excludes secrets',async()=>{
  const discovery=await scim('get','/ServiceProviderConfig');expect(discovery.status).toBe(200);expect(discovery.type).toBe('application/scim+json');expect(discovery.body.patch.supported).toBe(true);
  expect((await scim('get','/ResourceTypes')).body.Resources.map(row=>row.id)).toEqual(['User','Group']);
  expect((await scim('get','/Schemas')).body.Resources.map(row=>row.id)).toEqual([S.USER,S.GROUP]);
  expect((await scim('get','/Users',undefined,rootToken)).status).toBe(401);
  expect((await scim('get','/Users',undefined,credential.token,orgB)).status).toBe(401);
  expect((await api('post','/admin/integrations/directories/'+dir.id+'/credentials',adminToken,{ expiresInDays:30 })).status).toBe(403);
  expect((await api('get','/admin/integrations/directories/'+dir.id+'/credentials',otherToken)).status).toBe(404);
  const metadata=await api('get','/admin/integrations/directories/'+dir.id+'/credentials',rootToken);
  expect(metadata.body.credentials[0]).toMatchObject({ id:credential.credential.id,last_used_at:expect.any(String) });
  expect(JSON.stringify(metadata.body)).not.toMatch(/rsx_scim|token_hash/);
  expect((await api('get','/organization',credential.token)).status).toBe(401);
});
test('production SCIM accepts trusted TLS termination and rejects spoofed TLS and ordinary off-network APIs',async()=>{
  const base={ NODE_ENV:'production',DATABASE_URL:restricted.toString(),JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),
    VPN_REQUIRED:'true',DB_NETWORK_TRUSTED:'true',SCIM_ENABLED:'true',SCIM_PUBLIC_BASE_URL:'https://scim.example.test/scim/v2',CORS_ORIGINS:'https://console.example.test' };
  const proxyApp=createApp({ config:loadConfig({...base,TRUST_PROXY_CIDRS:'127.0.0.1/32'}),logger,database:db });
  const directApp=createApp({ config:loadConfig(base),logger,database:db });
  const path='/scim/v2/'+orgA+'/Users';
  const valid=req=>req.auth(credential.token,{type:'bearer'}).set('X-Forwarded-Proto','https').set('X-Forwarded-For','192.0.2.9');
  expect((await valid(request(directApp).get(path))).status).toBe(400);
  expect((await valid(request(proxyApp).get(path))).status).toBe(200);
  expect((await valid(request(proxyApp).get('/api/v1/organization'))).status).toBe(403);
});
test('SCIM users support case-insensitive matching and cannot adopt a local account or set a role',async()=>{
  expect((await scim('post','/Users',makeUser('LOCALUSER',{ emails:[{value:'unused@test.example'}] }))).status).toBe(409);
  expect((await scim('post','/Users',makeUser('forgery',{ role:'superadmin' }))).status).toBe(400);
  const created=await scim('post','/Users',makeUser('employee@test.example',{ emails:[{value:'employee@test.example',type:'work'}] }));
  expect(created.status).toBe(201);member=created.body;
  expect(member.meta.version).toBe('W/"1"');
  expect((await scim('get','/Users').query({ filter:'userName eq "EMPLOYEE@test.example"',count:'2' })).body.Resources[0].id).toBe(member.id);
  expect((await scim('get','/Users').query({ filter:'userName eq "EMPLOYEE@test.example"',count:'0' })).body).toMatchObject({ totalResults:1,itemsPerPage:0 });
  expect((await scim('get','/Users').query({ filter:'userName pr' })).body.scimType).toBe('invalidFilter');
  expect((await scim('get','/Users/'+member.id,undefined,secondary.token)).status).toBe(404);
  const managed=(await pool.query('SELECT password_auth_enabled,role FROM users WHERE id=$1',[member.id])).rows[0];
  expect(managed).toEqual({ password_auth_enabled:false,role:'user' });
});
test('SCIM versions, groups, roles and group policy assignment enforce authorization and revoke sessions',async()=>{
  const created=await scim('post','/Groups',{ schemas:[S.GROUP],displayName:'Managed browsers',externalId:'fixture-group' });
  expect(created.status).toBe(201);group=created.body;
  expect((await scim('patch','/Groups/'+group.id,patch({ op:'Add',path:'members',value:[{value:local}] }))).status).toBe(400);
  const token=await fixtureAccess(member.id);
  const added=await scim('patch','/Groups/'+group.id,patch({ op:'Add',path:'members',value:[{value:member.id}] })).set('If-Match',group.meta.version);
  expect(added.status).toBe(200);group=added.body;
  expect((await api('get','/organization',token)).status).toBe(401);
  expect((await scim('patch','/Groups/'+group.id,patch({ op:'Add',path:'members',value:[{value:member.id}] })).set('If-Match','W/"1"')).status).toBe(412);
  expect((await scim('patch','/Groups/'+group.id,patch({ op:'Replace',path:'members' }))).status).toBe(400);
  expect((await scim('get','/Groups/'+group.id).query({ excludedAttributes:'members' })).body).not.toHaveProperty('members');
  expect((await api('patch','/admin/integrations/groups/'+group.id+'/mapping',adminToken,{ revision:2,role:'admin' })).status).toBe(403);
  expect((await api('patch','/admin/integrations/groups/'+group.id+'/mapping',rootToken,{ revision:2,role:'superadmin' })).status).toBe(400);
  const mapping=await api('patch','/admin/integrations/groups/'+group.id+'/mapping',rootToken,{ revision:2,role:'admin' });expect(mapping.status).toBe(200);
  const mappedToken=await fixtureAccess(member.id);
  expect((await api('get','/admin/account',mappedToken)).body.account.role).toBe('admin');
  expect((await api('patch','/admin/users/'+member.id+'/role',rootToken,{ role:'user' })).status).toBe(409);
  const policy={ name:'Directory policy',rules:{ deny:['blocked.test'],allow:[] },assignment:{ scope:'groups',userIds:[],groupIds:[group.id] } };
  expect((await api('post','/policies',otherToken,policy)).status).toBe(400);
  const saved=await api('post','/policies',rootToken,policy);expect(saved.status).toBe(201);
  expect((await api('post','/policies/evaluate',mappedToken,{ url:'https://blocked.test' })).body.allowed).toBe(false);
  expect((await api('post','/policies/evaluate',localToken,{ url:'https://blocked.test' })).body.allowed).toBe(true);
  const removed=await scim('patch','/Groups/'+group.id,patch({ op:'Remove',path:`members[value eq "${member.id}"]` }));
  expect(removed.status).toBe(200);expect(removed.body.members).toEqual([]);
  expect((await api('get','/organization',mappedToken)).status).toBe(401);
  const changedToken=await fixtureAccess(member.id);
  expect((await api('get','/admin/account',changedToken)).status).toBe(403);
  expect((await api('post','/policies/evaluate',changedToken,{ url:'https://blocked.test' })).body.allowed).toBe(true);
});
test('SCIM deactivation and deletion revoke sessions, recover from audit rollback and are retry-safe',async()=>{
  const token=await fixtureAccess(member.id);
  const disable=()=>scim('patch','/Users/'+member.id,patch({ op:'Replace',value:{ active:false } }));
  await pool.query("CREATE FUNCTION fail_gov_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$");
  await pool.query("CREATE TRIGGER fail_gov_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.action='scim.user_update') EXECUTE FUNCTION fail_gov_audit()");
  try {
    expect((await disable()).status).toBe(500);
    expect((await api('get','/organization',token)).status).toBe(200);
    expect((await scim('get','/Users/'+member.id)).body.active).toBe(true);
  } finally { await pool.query('DROP TRIGGER fail_gov_audit ON audit_log'); }
  expect((await disable()).body.active).toBe(false);
  const { externalId, active, ...replacement }=(await scim('get','/Users/'+member.id)).body;
  const replaced=await scim('put','/Users/'+member.id,replacement);
  expect(replaced.body).toMatchObject({ externalId,active });
  expect((await api('get','/organization',token)).status).toBe(401);
  expect((await disable()).body.active).toBe(false);
  expect((await scim('patch','/Users/'+member.id,patch({ op:'replace',path:'active',value:true }))).body.active).toBe(true);
  expect((await api('get','/organization',token)).status).toBe(401);
  expect((await scim('delete','/Users/'+member.id)).status).toBe(204);
  expect((await scim('delete','/Users/'+member.id)).status).toBe(204);
  expect((await scim('get','/Users/'+member.id)).status).toBe(404);
  expect((await scim('delete','/Groups/'+group.id)).status).toBe(204);
  expect((await scim('get','/Groups/'+group.id)).status).toBe(404);
});
test('credentials rotate and disablement prevents future use without leaking token material',async()=>{
  const replacement=await issue(dir.id);
  const expiring=await issue(dir.id);
  await pool.query("UPDATE provisioning_credentials SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[expiring.credential.id]);
  expect((await scim('get','/Users',undefined,expiring.token)).status).toBe(401);
  expect((await api('delete','/admin/integrations/credentials/'+credential.credential.id,rootToken)).status).toBe(200);
  expect((await scim('get','/Users')).status).toBe(401);
  expect((await scim('get','/Users',undefined,replacement.token)).status).toBe(200);
  expect((await api('patch','/admin/integrations/directories/'+dir.id,rootToken,{ revision:dir.revision,name:dir.name,isActive:false,ssoLinking:false })).status).toBe(200);
  expect((await scim('get','/Users',undefined,replacement.token)).status).toBe(401);
  expect(JSON.stringify(logs)).not.toContain(replacement.token);
});
test('reviews require an independent reviewer, reject stale snapshots and close with immutable decisions',async()=>{
  expect((await api('get','/admin/governance/reviews',localToken)).status).toBe(403);
  const created=await api('post','/admin/governance/reviews',rootToken,{ name:'Quarterly fixture',dueAt:new Date(Date.now()+86400000).toISOString() });
  expect(created.status).toBe(201);const review=created.body.review,path='/admin/governance/reviews/'+review.id;
  expect((await api('get',path+'/items',otherToken)).status).toBe(404);
  let items=(await api('get',path+'/items',rootToken)).body.items;
  const self=items.find(item=>item.user_id===root),user=items.find(item=>item.user_id===local),subAdmin=items.find(item=>item.user_id===admin);
  const decide=(item,token,decision='retain')=>api('patch',path+'/items/'+item.id,token,{ revision:item.revision,decision,reason:decision==='retain' ? 'access_required' : 'no_longer_needed' });
  expect((await decide(self,rootToken)).status).toBe(403);
  expect((await api('post',path+'/close',rootToken,{ revision:review.revision })).status).toBe(409);
  expect((await api('patch','/admin/users/'+local+'/lock',rootToken,{ locked:true })).status).toBe(200);
  expect((await decide(user,rootToken)).body.code).toBe('REVIEW_SNAPSHOT_STALE');
  const fresh=await api('post',path+'/items/'+user.id+'/refresh',rootToken,{ revision:user.revision });expect(fresh.status).toBe(200);
  expect((await decide(fresh.body.item,rootToken,'revoke')).status).toBe(200);
  expect((await api('get','/organization',localToken)).status).toBe(401);
  expect((await decide(self,adminToken)).status).toBe(200);
  expect((await decide(subAdmin,rootToken)).status).toBe(200);
  expect((await decide(subAdmin,rootToken)).status).toBe(409);
  expect((await api('post',path+'/close',rootToken,{ revision:review.revision })).status).toBe(200);
  items=(await api('get',path+'/items',rootToken)).body.items;
  expect(items.map(item=>item.decision).sort()).toEqual(['retain','retain','revoke']);
  await withTenant(orgA,async()=>{
    await expect(db.query('DELETE FROM access_review_decisions')).rejects.toMatchObject({ code:'42501' });
    await expect(db.query('DELETE FROM governance_changes')).rejects.toMatchObject({ code:'42501' });
  });
});
test('export cursors are tenant and dataset bound and the manifest verifies against serialized rows',async()=>{
  const path='/admin/governance/exports';
  const first=await api('post',path,rootToken,{ dataset:'audit',limit:2 });expect(first.status).toBe(200);
  expect(first.body.manifest.sha256).toBe(digest(first.body.rows));expect(first.body.nextCursor).toBeTruthy();
  expect(first.body.rows.every(row=>!Object.hasOwn(row,'ip_address'))).toBe(true);
  const next=await api('post',path,rootToken,{ dataset:'audit',cursor:first.body.nextCursor,limit:2 });expect(next.status).toBe(200);
  expect(next.body.manifest.criteria.to).toBe(first.body.manifest.criteria.to);
  expect(next.body.rows.map(row=>row.id).some(id=>first.body.rows.some(row=>row.id===id))).toBe(false);
  expect((await api('post',path,otherToken,{ dataset:'audit',cursor:first.body.nextCursor })).status).toBe(400);
  expect((await api('post',path,rootToken,{ dataset:'users',cursor:first.body.nextCursor })).status).toBe(400);
  expect((await api('post',path,rootToken,{ dataset:'audit',cursor:first.body.nextCursor+'x' })).status).toBe(400);
  const reviewed=await api('post',path,rootToken,{ dataset:'reviews' });expect(reviewed.body.rows).toHaveLength(3);
  expect((await pool.query('SELECT digest FROM evidence_exports WHERE id=$1',[first.body.manifest.exportId])).rows[0].digest).toBe(first.body.manifest.sha256);
});
test('privileged lifecycle commands scope all writes even when the owner bypasses RLS',async()=>{
  const organizationId=randomUUID();
  const initial=await onboard(pool,{ organizationId,name:'Disposable tenant',username:'bootstrapadmin',email:'bootstrap@test.example',password:'TestPassword1!' });
  const token=await login('bootstrapadmin',organizationId);const source=await directory('Disposable directory',token);const integration=await issue(source.id,token);
  const device=(await pool.query(`INSERT INTO devices(organization_id,user_id,external_id,name,platform) VALUES($1,$2,'fixture','Device','linux') RETURNING id`,[organizationId,initial.bootstrapAdministratorId])).rows[0];
  await expect(onboard(pool,{ organizationId,name:'Duplicate',username:'bootstrapadmin',email:'bootstrap@test.example',password:'TestPassword1!' })).rejects.toMatchObject({ status:409 });
  expect((await scim('get','/Users',undefined,integration.token,organizationId)).status).toBe(200);
  const result=await offboard(pool,organizationId);expect(result).toMatchObject({ gatewayPeerRevocationRequired:true,deviceIds:[device.id] });
  expect((await api('get','/organization',token)).status).toBe(401);
  expect((await scim('get','/Users',undefined,integration.token,organizationId)).status).toBe(401);
  expect(await offboard(pool,organizationId)).toEqual(result);
  expect((await api('get','/organization',otherToken)).body.organization.id).toBe(orgB);
  expect((await api('get','/organization',rootToken)).body.organization.id).toBe(orgA);
  expect((await pool.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE organization_id=$1 AND action='organization.offboard'",[organizationId])).rows[0].n).toBe(1);
});
