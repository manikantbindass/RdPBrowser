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
const key=crypto.generateKeyPairSync('rsa',{ modulusLength:2048 });
const wrongKey=crypto.generateKeyPairSync('rsa',{ modulusLength:2048 });
const jwk={ ...key.publicKey.export({ format:'jwk' }),kid:'test-signing-key',use:'sig',alg:'RS256' };
const provider={ id:'enterprise',organizationId:orgA,issuer,clientId:'fixture-client',clientSecret:crypto.randomBytes(24).toString('hex'),
  redirectUri:'https://app.test/api/v1/auth/oidc/enterprise/callback',mfaAcrValues:['urn:test:mfa'],mfaAmrValues:['mfa'],maxAuthenticationAgeSeconds:3600 };
let nonce,challenge,mode='valid',runtime,pool;
const owner=new Pool({ connectionString:url,connectionTimeoutMillis:5000,statement_timeout:15000 });
const response=value => new Response(JSON.stringify(value),{ headers:{ 'content-type':'application/json' } });
async function transport(input,options) {
  const req=new Request(input,options),path=new URL(req.url).pathname;
  if (path.endsWith('/.well-known/openid-configuration')) return response({ issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',
    response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256'] });
  if (path==='/jwks') return response({ keys:[jwk] });
  if (path==='/token') {
    const body=new URLSearchParams(await req.text());
    assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'),challenge,'PKCE S256 must bind the token exchange');
    assert.equal(body.get('redirect_uri'),provider.redirectUri);
    assert.equal(body.get('client_secret'),provider.clientSecret);
    const now=Math.floor(Date.now()/1000);
    const claims={ iss:mode==='issuer' ? 'https://wrong.test' : issuer,aud:mode==='audience' ? 'another-client' : provider.clientId,
      sub:mode==='admin' ? 'administrator-subject' : mode==='unlinked' ? 'unlinked-subject' : 'employee-subject',
      iat:now,exp:mode==='expired' ? now-60 : now+300,auth_time:now,nonce:mode==='nonce' ? 'incorrect-nonce' : nonce,
      // Malicious external roles must never grant local administrative privileges.
      roles:['superadmin'],acr:mode==='no-mfa' ? 'urn:test:password' : 'urn:test:mfa',amr:mode==='no-mfa' ? ['pwd'] : ['pwd','mfa'] };
    claims.email='employee@test.example.com';claims.email_verified=true;
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
  DEVICE_BINDING_ENABLED:'false',AUTH_RATE_LIMIT_MAX:'1000',RATE_LIMIT_MAX:'10000' }),PORT:0,OIDC_STATE_KEY:crypto.randomBytes(32).toString('hex'),
  oidcProviders:[provider,{ ...provider,id:'other',organizationId:orgB,redirectUri:'https://app.test/api/v1/auth/oidc/other/callback' }] };
const checks=[];
async function start() {
  const result=await request(runtime.app).get('/api/v1/auth/oidc/enterprise/start');
  assert.equal(result.status,303);
  const auth=new URL(result.headers.location);nonce=auth.searchParams.get('nonce');challenge=auth.searchParams.get('code_challenge');
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('scope'),'openid');
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
    runtime=createRuntime({ config,logger:{ info() {},warn() {},error() {} },database });await runtime.start();
    let flow=await start();let result=await callback(flow);
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
    const link=(await pool.query('SELECT id FROM identity_links WHERE user_id=$1',[admin.id])).rows[0];
    assert.equal((await request(runtime.app).delete('/api/v1/admin/identity-links/'+link.id).auth(token,{ type:'bearer' })).status,200);
    assert.equal((await request(runtime.app).get('/api/v1/admin/users').auth(token,{ type:'bearer' })).status,401);checks.push('unlink revokes enterprise sessions');
    assert.equal((await pool.query("SELECT id FROM access_decisions WHERE outcome='deny' AND reason='MFA_REQUIRED'")).rows.length>0,true);
    assert.equal((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND column_name IN ('id_token','provider_access_token','client_secret')",[schema])).rows.length,0);
    console.log(JSON.stringify({ suite:'OIDC signed protocol + PostgreSQL HTTP integration',checks:checks.length,passed:checks }));
  } finally {
    if (runtime) await runtime.stop();if (pool) await pool.end();
    try { await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.query(`DROP ROLE IF EXISTS ${role}`); } finally { await owner.end(); }
  }
})().catch(error => { console.error(error.message);process.exitCode=1; });
