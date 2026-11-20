'use strict';
// Real openid-client/JWK signatures and PostgreSQL/HTTP; only outbound IdP transport is a test fixture.
const assert=require('assert/strict');
const crypto=require('crypto');
const { Pool }=require('pg');
const request=require('supertest');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const { migrate }=require('../src/db/migrations');
const { provision }=require('../src/db/provision');
const { DEFAULT_ORGANIZATION:orgA }=require('../src/db/tenant');
const { defaults }=require('../src/services/access');
const realFactory=require('../src/services/oidc-client').createOidcClient;
const url=process.env.INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated _test database required');
const schema='oidc_'+crypto.randomUUID().replace(/-/g,''),role='test_'+crypto.randomUUID().replace(/-/g,'');
const password=crypto.randomBytes(32).toString('hex'),orgB=crypto.randomUUID();
const issuer='https://idp.test';
const entraTenant=crypto.randomUUID(),entraObject=crypto.randomUUID();
const entraIssuer='https://login.microsoftonline.com/'+entraTenant+'/v2.0';
const key=crypto.generateKeyPairSync('rsa',{ modulusLength:2048 });
const wrongKey=crypto.generateKeyPairSync('rsa',{ modulusLength:2048 });
const jwk={ ...key.publicKey.export({ format:'jwk' }),kid:'test-signing-key',use:'sig',alg:'RS256' };
const provider={ id:'enterprise',organizationId:orgA,issuer,clientId:'fixture-client',clientSecret:crypto.randomBytes(24).toString('hex'),
  redirectUri:'https://app.test/api/v1/auth/oidc/enterprise/callback',mfaAcrValues:['urn:test:mfa'],mfaAmrValues:['mfa'],maxAuthenticationAgeSeconds:3600 };
const entraProvider={ ...provider,id:'entra',issuer:entraIssuer,kind:'entra',requireActivation:true,provisioningSubjectClaim:'oid',
  redirectUri:'https://app.test/api/v1/auth/oidc/entra/callback' };
let nonce,challenge,mode='valid',runtime,pool,discoveryMode='valid';
const owner=new Pool({ connectionString:url,connectionTimeoutMillis:5000,statement_timeout:15000 });
const response=value => new Response(JSON.stringify(value),{ headers:{ 'content-type':'application/json' } });
async function transport(input,options) {
  const req=new Request(input,options),url=new URL(req.url),path=url.pathname;
  const entra=url.hostname==='login.microsoftonline.com';
  const active=entra ? entraProvider : provider;
  const origin=entra ? url.origin : issuer;
  if (path.endsWith('/.well-known/openid-configuration')) {
    if (discoveryMode==='unavailable') throw new Error('fixture discovery outage');
    return response({ issuer:active.issuer,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',jwks_uri:origin+'/jwks',
      response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:[discoveryMode==='weak' ? 'plain' : 'S256'] });
  }
  if (path==='/jwks') return response({ keys:[jwk] });
  if (path==='/token') {
    const body=new URLSearchParams(await req.text());
    assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'),challenge,'PKCE S256 must bind the token exchange');
    assert.equal(body.get('redirect_uri'),active.redirectUri);
    assert.equal(body.get('client_secret'),active.clientSecret);
    const now=Math.floor(Date.now()/1000);
    const claims={ iss:mode==='issuer' ? 'https://wrong.test' : active.issuer,aud:mode==='audience' ? 'another-client' : active.clientId,
      sub:entra ? 'entra-app-pairwise-subject' : mode==='admin' ? 'administrator-subject' : mode==='unlinked' ? 'unlinked-subject' : 'employee-subject',
      iat:now,exp:mode==='expired' ? now-60 : now+300,auth_time:now,nonce:mode==='nonce' ? 'incorrect-nonce' : nonce,
      // Malicious external roles must never grant local administrative privileges.
      roles:['superadmin'],acr:mode==='no-mfa' ? 'urn:test:password' : 'urn:test:mfa',amr:mode==='no-mfa' ? ['pwd'] : ['pwd','mfa'] };
    claims.email='employee@test.example.com';claims.email_verified=true;
    if (entra) { claims.oid=entraObject;claims.tid=mode==='wrong-tid' ? crypto.randomUUID() : entraTenant; }
    if (mode==='missing-auth-time') delete claims.auth_time;
    if (mode==='future-auth-time') claims.auth_time=now+600;
    return response({ access_token:'fixture-provider-access-not-stored',token_type:'Bearer',expires_in:300,
      id_token:mode==='algorithm' ? jwt.sign(claims,crypto.randomBytes(32),{ algorithm:'HS256' }) : jwt.sign(claims,mode==='signature' ? wrongKey.privateKey : key.privateKey,{ algorithm:'RS256',keyid:jwk.kid }) });
  }
  throw new Error('Unexpected fixture transport path');
}
// Explicit test-only replacement. Production routes always use the normal HTTPS transport.
require('../src/services/oidc-client').createOidcClient=p => realFactory(p,transport);
const { loadConfig }=require('../src/config');
const { createRuntime }=require('../src/runtime');
const database=require('../src/db/db');
const scoped=new URL(url);scoped.searchParams.set('options',`-c search_path=${schema},public`);
const runtimeUrl=new URL(scoped);runtimeUrl.username=role;runtimeUrl.password=password;
const config={ ...loadConfig({ NODE_ENV:'test',DATABASE_URL:runtimeUrl.toString(),JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),VPN_REQUIRED:'false',
  DEVICE_BINDING_ENABLED:'false',AUTH_RATE_LIMIT_MAX:'1000',RATE_LIMIT_MAX:'10000',CORS_ORIGINS:'https://app.test',SCIM_ENABLED:'true' }),PORT:0,OIDC_STATE_KEY:crypto.randomBytes(32).toString('hex'),
  oidcProviders:[provider,entraProvider,{ ...provider,id:'other',organizationId:orgB,redirectUri:'https://app.test/api/v1/auth/oidc/other/callback' }] };
const checks=[];
async function start(consoleReturn=false,providerId='enterprise') {
  const result=await request(runtime.app).get('/api/v1/auth/oidc/'+providerId+'/start'+(consoleReturn ? '?return=console' : ''));
  assert.equal(result.status,303);
  const auth=new URL(result.headers.location);nonce=auth.searchParams.get('nonce');challenge=auth.searchParams.get('code_challenge');
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('scope'),providerId==='entra' ? 'openid profile' : 'openid');
  assert.match(result.headers['set-cookie'][0],/HttpOnly/);assert.match(result.headers['set-cookie'][0],/Secure/);assert.match(result.headers['set-cookie'][0],/SameSite=Lax/);
  return { state:auth.searchParams.get('state'),cookie:result.headers['set-cookie'][0].split(';')[0] };
}
function callback(flow,providerId='enterprise') {
  return request(runtime.app).get(`/api/v1/auth/oidc/${providerId}/callback`).query({ state:flow.state,code:'test-authorization-code' }).set('Cookie',flow.cookie);
}
(async () => {
  try {
    await owner.query(`CREATE SCHEMA ${schema}`);pool=new Pool({ connectionString:scoped.toString(),connectionTimeoutMillis:5000,statement_timeout:15000 });
    await migrate(pool);await provision(pool,{ role,password,schema });
    await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[orgB,'Other organization']);
    const hash=await bcrypt.hash('FixturePassword1!',4);
    const employee=(await pool.query("INSERT INTO users(organization_id,username,email,password_hash) VALUES($1,'employee','employee@test.example.com',$2) RETURNING id",[orgA,hash])).rows[0];
    const admin=(await pool.query("INSERT INTO users(organization_id,username,email,password_hash,role) VALUES($1,'ssoadmin','admin@test.example.com',$2,'admin') RETURNING id",[orgA,hash])).rows[0];
    await pool.query('INSERT INTO identity_links(organization_id,user_id,provider_id,issuer,subject) VALUES($1,$2,$3,$4,$5),($1,$6,$3,$4,$7)',
      [orgA,employee.id,provider.id,issuer,'employee-subject',admin.id,'administrator-subject']);
    await pool.query("INSERT INTO users(organization_id,username,email,password_hash,role) VALUES($1,'bootstrap','boot@test.example.com',$2,'superadmin')",[orgA,hash]);
    runtime=createRuntime({ config,logger:{ info() {},warn() {},error() {} },database });await runtime.start();
    const superuser=await request(runtime.app).post('/api/v1/auth/login').send({ username:'bootstrap',password:'FixturePassword1!' });
    assert.equal(superuser.status,200);
    const integration=(method,suffix,body)=>{
      const req=request(runtime.app)[method]('/api/v1/admin/integrations/oidc'+suffix).auth(superuser.body.accessToken,{ type:'bearer' });
      return body ? req.send(body) : req;
    };
    assert.equal((await integration('get','')).body.providers[0].status,'legacy_enabled');
    assert.equal((await integration('get','')).body.providers[0].clientSecret,undefined);
    assert.equal((await integration('put','/enterprise/state',{ revision:0,enabled:true })).status,409);
    discoveryMode='unavailable';assert.equal((await integration('post','/enterprise/validate')).status,503);
    discoveryMode='weak';assert.equal((await integration('post','/enterprise/validate')).status,400);
    discoveryMode='valid';const validated=await integration('post','/enterprise/validate');assert.equal(validated.status,200);assert.equal(validated.body.enabled,true);
    assert.ok(Object.values(validated.body.checks).every(Boolean));
    assert.equal((await integration('put','/enterprise/state',{ revision:1,enabled:false })).status,200);
    assert.equal((await request(runtime.app).get('/api/v1/auth/oidc/enterprise/start')).status,403);
    assert.equal((await integration('put','/enterprise/state',{ revision:1,enabled:true })).status,409);
    assert.equal((await integration('put','/enterprise/state',{ revision:2,enabled:true })).status,200);
    checks.push('sanitized OIDC inventory, metadata validation, outage recovery and revision-checked activation');
    assert.equal((await request(runtime.app).get('/api/v1/auth/oidc/entra/start')).status,403);
    const staged=await integration('post','/entra/validate');assert.equal(staged.status,200);assert.equal(staged.body.enabled,false);
    assert.equal((await integration('put','/entra/state',{ revision:staged.body.revision,enabled:true })).status,200);
    const directory=await request(runtime.app).post('/api/v1/admin/integrations/directories').auth(superuser.body.accessToken,{type:'bearer'})
      .send({ name:'Entra fixture',providerId:'entra',ssoLinking:true });assert.equal(directory.status,201);
    const issued=await request(runtime.app).post('/api/v1/admin/integrations/directories/'+directory.body.directory.id+'/credentials').auth(superuser.body.accessToken,{type:'bearer'}).send({ expiresInDays:10 });
    assert.equal(issued.status,201);
    const provisioned=await request(runtime.app).post('/scim/v2/'+orgA+'/Users').auth(issued.body.token,{type:'bearer'}).send({
      schemas:['urn:ietf:params:scim:schemas:core:2.0:User'],userName:'entraemployee',externalId:entraObject,emails:[{value:'entraemployee@test.example.com'}],active:true });
    assert.equal(provisioned.status,201);
    let flow=await start(false,'entra');mode='wrong-tid';assert.equal((await callback(flow,'entra')).status,401);mode='valid';
    flow=await start(false,'entra');const linked=await callback(flow,'entra');assert.equal(linked.status,200);assert.equal(linked.body.user.id,provisioned.body.id);assert.equal(linked.body.user.role,'user');
    const deprovisioned=await request(runtime.app).patch('/scim/v2/'+orgA+'/Users/'+provisioned.body.id).auth(issued.body.token,{type:'bearer'}).send({
      schemas:['urn:ietf:params:scim:api:messages:2.0:PatchOp'],Operations:[{op:'Replace',path:'active',value:'false'}] });
    assert.equal(deprovisioned.status,200);assert.equal(deprovisioned.body.active,false);
    assert.equal((await request(runtime.app).get('/api/v1/organization').auth(linked.body.accessToken,{type:'bearer'})).status,401);
    flow=await start(false,'entra');assert.equal((await callback(flow,'entra')).status,403);
    checks.push('Entra issuer and tid/oid binding to actual SCIM-provisioned user, deactivation and no role claim escalation');
    flow=await start();let result=await callback(flow);
    assert.equal(result.status,200);assert.equal(result.body.user.id,employee.id);assert.equal(result.body.user.role,'user');
    assert.equal(result.headers['cache-control'],'no-store');assert.equal(result.headers['referrer-policy'],'no-referrer');
    assert.equal((await callback(flow)).status,401);checks.push('PKCE, state, nonce, signed identity, exact local link, no external role escalation, replay');
    for (const failure of ['nonce','audience','issuer','expired','signature','algorithm','missing-auth-time','future-auth-time']) {
      flow=await start();mode=failure;result=await callback(flow);assert.equal(result.status,401,`${failure} must be denied`);mode='valid';
      checks.push('reject '+failure);
    }
    flow=await start();
    assert.equal((await request(runtime.app).get('/api/v1/auth/oidc/enterprise/callback').query({ state:flow.state,code:'test-authorization-code' })).status,401);
    checks.push('missing browser cookie');
    flow=await start();const wrongBrowser={ ...flow,cookie:'__Host-rsx_oidc='+crypto.randomBytes(32).toString('base64url') };
    assert.equal((await callback(wrongBrowser)).status,401);assert.equal((await callback(flow)).status,200);checks.push('browser binding');
    flow=await start();assert.equal((await callback(flow,'other')).status,401);checks.push('cross-tenant provider mix-up');
    flow=await start();await pool.query("UPDATE oidc_transactions SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal((await callback(flow)).status,401);checks.push('expired OIDC transaction');
    flow=await start();mode='unlinked';assert.equal((await callback(flow)).status,403);mode='valid';checks.push('no email auto-link/JIT privilege');
    flow=await start();mode='admin';result=await callback(flow);assert.equal(result.status,200);
    assert.equal((await request(runtime.app).put('/api/v1/admin/access-policy').auth(result.body.accessToken,{ type:'bearer' })
      .send({ revision:0,configuration:{ ...defaults,requireMfa:true } })).status,200);mode='valid';checks.push('MFA policy activation requires a currently verified administrator');
    assert.equal((await request(runtime.app).post('/api/v1/auth/login').send({ username:'employee',password:'FixturePassword1!' })).status,403);checks.push('password cannot bypass MFA');
    assert.equal((await request(runtime.app).post('/api/v1/auth/login').send({ username:'employee',password:'FixturePassword1!',mfaVerified:true })).status,400);
    flow=await start();mode='no-mfa';result=await callback(flow);assert.equal(result.status,403);assert.equal(result.body.code,'MFA_REQUIRED');checks.push('provider MFA assurance required');
    flow=await start();mode='admin';result=await callback(flow);assert.equal(result.status,200);assert.equal(result.body.user.role,'admin');
    const token=result.body.accessToken;
    assert.equal((await request(runtime.app).get('/api/v1/admin/users').auth(token,{ type:'bearer' })).status,200);checks.push('verified enterprise MFA admin');
    flow=await start(true);result=await callback(flow);assert.equal(result.status,303);assert.equal(result.headers.location,'/admin/#sso=enterprise');
    assert.equal(result.body.accessToken,undefined);
    const grant=result.headers['set-cookie'].find(value=>value.startsWith('__Host-rsx_console='));
    assert.match(grant,/HttpOnly/);assert.match(grant,/Secure/);assert.match(grant,/SameSite=Strict/);
    const exchange=origin=>request(runtime.app).post('/api/v1/auth/oidc/enterprise/console-session').set('Origin',origin).set('Cookie',grant.split(';')[0]);
    assert.equal((await exchange('https://untrusted.test')).status,403);
    const handoff=await exchange('https://app.test');assert.equal(handoff.status,200);assert.equal(handoff.body.user.id,admin.id);
    assert.equal((await exchange('https://app.test')).status,401);
    checks.push('one-use origin-bound administrator SSO handoff with no tokens in redirect');
    const link=(await pool.query('SELECT id FROM identity_links WHERE user_id=$1',[admin.id])).rows[0];
    assert.equal((await request(runtime.app).delete('/api/v1/admin/identity-links/'+link.id).auth(handoff.body.accessToken,{ type:'bearer' })).status,200);
    assert.equal((await request(runtime.app).get('/api/v1/admin/users').auth(handoff.body.accessToken,{ type:'bearer' })).status,401);checks.push('unlink revokes enterprise sessions');
    assert.equal((await pool.query("SELECT id FROM access_decisions WHERE outcome='deny' AND reason='MFA_REQUIRED'")).rows.length>0,true);
    assert.equal((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND column_name IN ('id_token','provider_access_token','client_secret')",[schema])).rows.length,0);
    console.log(JSON.stringify({ suite:'OIDC signed protocol + PostgreSQL HTTP integration',checks:checks.length,passed:checks }));
  } finally {
    if (runtime) await runtime.stop();if (pool) await pool.end();
    try { await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.query(`DROP ROLE IF EXISTS ${role}`); } finally { await owner.end(); }
  }
})().catch(error => { console.error(error.message);process.exitCode=1; });
