'use strict';
const { Pool }=require('pg');
const { randomUUID,createHash }=require('crypto');
const request=require('supertest');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const { io:connectSocket }=require('socket.io-client');
const { migrate }=require('../src/db/migrations');
const { provision }=require('../src/db/provision');
const { withTenant,DEFAULT_ORGANIZATION:orgA }=require('../src/db/tenant');
const database=require('../src/db/db');
const { createRuntime }=require('../src/runtime');
const { loadConfig }=require('../src/config');
const url=process.env.INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated _test database required');
const schema=`phase04_${randomUUID().replace(/-/g,'')}`;
const role=`test_${randomUUID().replace(/-/g,'')}`;
const password=randomUUID()+randomUUID();
const owner=new Pool({ connectionString:url,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000 });
let pool,restricted,runtime,tokenA,tokenB,userA,userB,deviceB,policyB,sessionB;
const orgB=randomUUID();
const logs=[];
const logger={ info:v => logs.push(v),warn:v => logs.push(v),error:v => logs.push(v) };
const scoped=new URL(url); scoped.searchParams.set('options',`-c search_path=${schema},public`);
const runtimeUrl=new URL(scoped); runtimeUrl.username=role; runtimeUrl.password=password;
const config={ ...loadConfig({ NODE_ENV:'test',DATABASE_URL:runtimeUrl.toString(),JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),
  VPN_REQUIRED:'false',DEVICE_BINDING_ENABLED:'false',RATE_LIMIT_MAX:'10000',AUTH_RATE_LIMIT_MAX:'1000' }),PORT:0 };
const call=(method,path,token,body) => {
  const req=request(runtime.app)[method](`/api/v1${path}`);
  if (token) req.auth(token,{ type:'bearer' });
  return body===undefined ? req : req.send(body);
};
async function login(username,organizationId=orgA) {
  const result=await call('post','/auth/login',null,{ username,password:'TestPassword1!',organizationId });
  expect(result.status).toBe(200); return result.body;
}
beforeAll(async () => {
  await owner.query(`CREATE SCHEMA ${schema}`);
  pool=new Pool({ connectionString:scoped.toString(),connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000 });
  await migrate(pool);
  await provision(pool,{ role,password,schema });
  restricted=new Pool({ connectionString:runtimeUrl.toString(),connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000 });
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[orgB,'Organization B']);
  const hash=await bcrypt.hash('TestPassword1!',4);
  userA=(await pool.query("INSERT INTO users(organization_id,username,email,password_hash,role) VALUES($1,'admina','a@test.example.com',$2,'admin') RETURNING id",[orgA,hash])).rows[0].id;
  userB=(await pool.query("INSERT INTO users(organization_id,username,email,password_hash,role) VALUES($1,'adminb','b@test.example.com',$2,'admin') RETURNING id",[orgB,hash])).rows[0].id;
  runtime=createRuntime({ config,logger,database }); await runtime.start();
  tokenA=(await login('admina')).accessToken; tokenB=(await login('adminb',orgB)).accessToken;
  deviceB=(await call('post','/devices',tokenB,{ externalId:'device-b',name:'B device',platform:'android' })).body.device.id;
  policyB=(await call('post','/policies',tokenB,{ name:'B policy',rules:{ deny:['*.blocked.test'],allow:[] } })).body.policy;
  sessionB=(await call('get','/sessions',tokenB)).body.sessions[0].id;
});
afterAll(async () => {
  if (runtime) await runtime.stop();
  if (restricted) await restricted.end();
  if (pool) await pool.end();
  try { await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await owner.query(`DROP ROLE IF EXISTS ${role}`); }
  finally { await owner.end(); }
});
test('database denies unscoped writes and hides reads; service requires tenant context',async () => {
  expect((await restricted.query('SELECT id FROM users')).rows).toEqual([]);
  await expect(restricted.query("INSERT INTO users(username,email,password_hash) VALUES('escape','escape@test.example.com','x')")).rejects.toMatchObject({ code:'42501' });
  await expect(database.query('SELECT id FROM users')).rejects.toThrow('Tenant context required');
  await withTenant(orgA,async () => {
    expect((await database.query('SELECT id FROM users WHERE id=$1',[userB])).rows).toEqual([]);
    expect((await database.query('UPDATE users SET is_locked=TRUE WHERE id=$1',[userB])).rowCount).toBe(0);
    await expect(database.query('INSERT INTO devices(organization_id,user_id,external_id,name,platform) VALUES($1,$2,$3,$4,$5)',[orgB,userB,'escape','Escape','linux'])).rejects.toMatchObject({ code:'42501' });
    await expect(database.query('INSERT INTO devices(user_id,external_id,name,platform) VALUES($1,$2,$3,$4)',[userB,'escape','Escape','linux'])).rejects.toMatchObject({ code:'23503' });
  });
});
test('runtime cannot change migration history, organizations or existing audit records',async () => {
  await expect(database.assertRuntimeRole(pool)).rejects.toThrow('must not bypass');
  await expect(database.assertRuntimeRole(restricted)).resolves.toBeUndefined();
  for (const sql of ['DELETE FROM schema_migrations','UPDATE organizations SET is_active=FALSE','DELETE FROM audit_log']) {
    await expect(restricted.query(sql)).rejects.toMatchObject({ code:'42501' });
  }
});
test('tenant lists, header spoofing and legacy aliases cannot expose another organization',async () => {
  const users=await request(runtime.app).get('/api/admin/users').auth(tokenA,{ type:'bearer' }).set('X-Organization-ID',orgB);
  expect(users.status).toBe(200); expect(users.body.users.map(u => u.id)).toEqual([userA]);
  expect((await call('get','/devices',tokenA)).body.devices).toEqual([]);
  expect((await call('get','/policies',tokenA)).body.policies).toEqual([]);
  expect((await call('get','/organization',tokenA)).body.organization.id).toBe(orgA);
});
test('cross-tenant user, device, session and policy mutations are rejected',async () => {
  const attempts=[
    ['patch',`/admin/users/${userB}/lock`,{ locked:true }],['delete',`/devices/${deviceB}`],['delete',`/sessions/${sessionB}`],
    ['post','/admin/force-logout',{ userId:userB }],['put',`/policies/${policyB.id}`,{ name:'Stolen',revision:1,rules:{ deny:[],allow:[] } }],
  ];
  for (const [method,path,body] of attempts) expect((await call(method,path,tokenA,body)).status).toBe(404);
  expect((await call('get','/sessions',tokenB)).status).toBe(200);
});
test('signed token with a different tenant fails session lookup',async () => {
  const forged=jwt.sign({ sub:userA,role:'admin',organizationId:orgB },config.JWT_SECRET,{ expiresIn:'1h' });
  expect((await call('get','/devices',forged)).status).toBe(401);
  const hash=createHash('sha256').update(forged).digest('hex');
  await expect(withTenant(orgB,() => database.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL \'1 hour\')',[userA,hash]))).rejects.toMatchObject({ code:'23503' });
});
test('registration stores a usable session; ordinary users cannot administer or create policies',async () => {
  const registered=await call('post','/auth/register',null,{ username:'newuser',email:'new@test.example.com',password:'TestPassword1!' });
  expect(registered.status).toBe(201);
  const token=registered.body.accessToken;
  expect((await call('get','/sessions',token)).body.sessions).toHaveLength(1);
  expect((await call('get','/admin/users',token)).status).toBe(403);
  expect((await call('post','/policies',token,{ name:'bad',rules:{ deny:[],allow:[] } })).status).toBe(403);
  expect((await call('post','/auth/register',null,{ username:'newuser',email:'new@test.example.com',password:'TestPassword1!' })).status).toBe(409);
  expect((await call('post','/auth/register',null,{ username:'escape',email:'escape@test.example.com',password:'TestPassword1!',organizationId:orgB })).status).toBe(400);
});
test('tenant admin registration creates only local ordinary users',async () => {
  const created=await call('post','/users',tokenB,{ username:'managed',email:'managed@test.example.com',password:'TestPassword1!' });
  expect(created.status).toBe(201); expect(created.body.user.role).toBe('user');
  expect((await login('managed',orgB)).user.organizationId).toBe(orgB);
  expect((await call('post','/auth/login',null,{ username:'managed',password:'TestPassword1!' })).status).toBe(401);
  expect((await call('post','/users',tokenB,{ username:'escape',email:'x@test.example.com',password:'TestPassword1!',role:'superadmin' })).status).toBe(400);
});
test('policy revisions, wildcard literals, legacy parity and protocol validation',async () => {
  const created=await call('post','/policies',tokenA,{ name:'URL policy',rules:{ deny:['*.blocked.test','a+b.test'],allow:['*.test'] } });
  expect(created.status).toBe(201);
  const policy=created.body.policy;
  const payload={ name:'URL policy',revision:1,rules:{ deny:['*.blocked.test','a+b.test'],allow:['*.test'] } };
  expect((await call('put',`/policies/${policy.id}`,tokenA,payload)).body.policy.revision).toBe(2);
  expect((await call('put',`/policies/${policy.id}`,tokenA,payload)).status).toBe(409);
  for (const route of ['/policies/evaluate','/proxy/navigate']) {
    const result=await call('post',route,tokenA,{ url:'https://x.blocked.test/' });
    if (route.includes('navigate')) expect(result.status).toBe(403); else expect(result.body.allowed).toBe(false);
  }
  expect((await call('get','/proxy/check?url=https%3A%2F%2Fx.blocked.test',tokenA)).body.allowed).toBe(false);
  expect((await call('post','/policies/evaluate',tokenA,{ url:'https://safe.test/' })).body.allowed).toBe(true);
  expect((await call('post','/policies/evaluate',tokenA,{ url:'file:///etc/passwd' })).status).toBe(400);
  expect((await call('post','/policies/evaluate',tokenA,{ url:'https://name:password@safe.test' })).status).toBe(400);
});
test('events validate device ownership, tenant, filters, deduplication and reject arbitrary secret payloads',async () => {
  const event={ clientEventId:randomUUID(),eventType:'browser.policy_denied',severity:'high',occurredAt:new Date().toISOString() };
  expect((await call('post','/events',tokenA,{ ...event,deviceId:deviceB })).status).toBe(404);
  expect((await call('post','/events',tokenA,{ ...event,metadata:{ privateKey:'SECRET' } })).status).toBe(400);
  const first=await call('post','/events',tokenA,event),second=await call('post','/events',tokenA,event);
  expect(first.status).toBe(201); expect(first.body.event.id).toBe(second.body.event.id);
  expect((await call('get','/events?severity=high&eventType=browser.policy_denied',tokenA)).body.events).toHaveLength(1);
  expect((await call('get','/events',tokenB)).body.events).toEqual([]);
});
test('lists reject malformed/unbounded pagination, identifiers, filters and boolean coercion',async () => {
  for (const path of ['/devices?limit=101','/sessions?page=-1','/policies?page=1.5','/events?severity=invalid','/admin/ip-logs?limit=1e9','/admin/users?page=10001']) {
    expect((await call('get',path,tokenA)).status).toBe(400);
  }
  expect((await call('delete','/devices/not-a-uuid',tokenA)).status).toBe(400);
  expect((await call('patch',`/admin/users/${userA}/lock`,tokenA,{ locked:'false' })).status).toBe(400);
});
test('failed audit insert rolls back critical mutation',async () => {
  await pool.query(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='block_url' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_test_audit()`);
  try {
    const result=await call('post','/admin/blocked-urls',tokenA,{ pattern:'rollback.test' });
    expect(result.status).toBe(500); expect(JSON.stringify(result.body)).not.toContain('test audit');
    expect((await pool.query("SELECT id FROM blocked_urls WHERE pattern='rollback.test'")).rows).toEqual([]);
  } finally { await pool.query('DROP TRIGGER reject_test_audit ON audit_log; DROP FUNCTION reject_test_audit()'); }
});
test('concurrent logins obey the session limit; refresh is single-use and logout revokes it',async () => {
  const created=await call('post','/users',tokenA,{ username:'racer',email:'race@test.example.com',password:'TestPassword1!' });
  const logins=await Promise.all([login('racer'),login('racer'),login('racer')]);
  expect((await pool.query('SELECT id FROM sessions WHERE user_id=$1 AND is_active',[created.body.user.id])).rows).toHaveLength(1);
  const checks=await Promise.all(logins.map(item => call('get','/sessions',item.accessToken)));
  expect(checks.filter(item => item.status===200)).toHaveLength(1);
  const live=logins[checks.findIndex(item => item.status===200)];
  const refreshes=await Promise.all([call('post','/auth/refresh',null,{ refreshToken:live.refreshToken }),call('post','/auth/refresh',null,{ refreshToken:live.refreshToken })]);
  expect(refreshes.map(r => r.status).sort()).toEqual([200,401]);
  expect((await call('get','/sessions',live.accessToken)).status).toBe(401);
  const rotated=refreshes.find(r => r.status===200).body;
  expect((await call('post','/auth/logout',rotated.accessToken,{})).status).toBe(200);
  expect((await call('post','/auth/refresh',null,{ refreshToken:rotated.refreshToken })).status).toBe(401);
});
test('account lock revokes access and refresh; live DB role overrides token role',async () => {
  const user=await call('post','/users',tokenA,{ username:'locktest',email:'lock@test.example.com',password:'TestPassword1!' });
  const session=await login('locktest');
  expect((await call('patch',`/admin/users/${user.body.user.id}/lock`,tokenA,{ locked:true })).status).toBe(200);
  expect((await call('get','/sessions',session.accessToken)).status).toBe(401);
  expect((await call('post','/auth/refresh',null,{ refreshToken:session.refreshToken })).status).toBe(401);
  await pool.query("UPDATE users SET role='user' WHERE id=$1",[userB]);
  expect((await call('get','/admin/users',tokenB)).status).toBe(403);
});
test('operational logs contain identifiers and request IDs without credentials or private key material',async () => {
  const text=JSON.stringify(logs);
  expect(text).not.toContain('TestPassword1!'); expect(text).not.toContain(tokenA); expect(text).not.toContain(tokenB);
  expect(text).not.toContain('SECRET'); expect(text).toContain('requestId');
  expect((await pool.query("SELECT request_id FROM audit_log WHERE action='login' AND request_id IS NOT NULL")).rows.length).toBeGreaterThan(0);
});
test('realtime cannot switch tenant identity or deliver to a revoked admin subscription',async () => {
  // A separate admin keeps the primary test session alive for further checks.
  const hash=await bcrypt.hash('TestPassword1!',4);
  const user=(await pool.query("INSERT INTO users(organization_id,username,email,password_hash,role) VALUES($1,'socketadmin','socket@test.example.com',$2,'admin') RETURNING id",[orgA,hash])).rows[0];
  const session=await login('socketadmin');
  const socket=connectSocket(`http://127.0.0.1:${runtime.server.address().port}`,{ auth:{ token:session.accessToken },reconnection:false });
  try {
    await new Promise((resolve,reject) => { socket.once('connect_error',reject); socket.once('connect',() => socket.emit('join_admin',session.accessToken)); socket.once('sessions_snapshot',resolve); });
    let received=false; socket.on('sensitive_test',() => { received=true; });
    await runtime.io.emitToAdmins(orgB,'sensitive_test',{ organizationId:orgB });
    expect(received).toBe(false);
    await call('patch',`/admin/users/${user.id}/lock`,tokenA,{ locked:true });
    const disconnected=new Promise(resolve => socket.once('disconnect',resolve));
    await runtime.io.emitToAdmins(orgA,'sensitive_test',{ organizationId:orgA });
    await disconnected;
    expect(received).toBe(false);
  } finally { socket.disconnect(); }
});
