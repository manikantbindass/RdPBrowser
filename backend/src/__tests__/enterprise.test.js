'use strict';
const request=require('supertest');
const { createApp }=require('../http/app');
const { loadConfig }=require('../config');
const { matches }=require('../services/policy');
const { redact }=require('../logging');
const { withTenant,tenantId,DEFAULT_ORGANIZATION }=require('../db/tenant');
const { createSourceGate }=require('../realtime/sourceGate');
const env={ NODE_ENV:'test',DATABASE_URL:'postgresql://test:local@localhost/test',JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),VPN_REQUIRED:'false' };
const logger={ info() {},error() {},warn() {} };
test('glob matching escapes all regular expression syntax',() => {
  expect(matches('a+b.test',new URL('https://aaab.test'))).toBe(false);
  expect(matches('*.test',new URL('https://sub.test/path'))).toBe(true);
  expect(matches('(a+)+.test',new URL('https://aaaa.test'))).toBe(false);
});
test('nested private WireGuard keys and credentials are redacted',() => {
  expect(redact({ WireGuard:{ privateKey:'private',preshared_key:'private' },authorization:'Bearer secret',accessToken:'private',event:'ok' }))
    .toEqual({ WireGuard:{ privateKey:'[REDACTED]',preshared_key:'[REDACTED]' },authorization:'[REDACTED]',accessToken:'[REDACTED]',event:'ok' });
});
test('tenant context is explicit and remains isolated across concurrent asynchronous work',async () => {
  expect(() => tenantId()).toThrow();
  const other='11111111-1111-4111-8111-111111111111';
  const values=await Promise.all([DEFAULT_ORGANIZATION,other].map(id => withTenant(id,async () => { await Promise.resolve(); return tenantId(); })));
  expect(values).toEqual([DEFAULT_ORGANIZATION,other]);
  expect(() => tenantId()).toThrow();
});
test('authentication limiter is shared across legacy/versioned aliases and errors carry correlation IDs',async () => {
  const app=createApp({ config:loadConfig({ ...env,AUTH_RATE_LIMIT_MAX:'1' }),logger,database:{} });
  expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
  const result=await request(app).post('/api/v1/auth/login').send({});
  expect(result.status).toBe(429); expect(result.body.code).toBe('RATE_LIMITED'); expect(result.body.requestId).toBe(result.headers['x-request-id']);
});
test('readiness fails during shutdown while liveness remains available',async () => {
  const app=createApp({ config:loadConfig(env),logger,database:{ checkReady:async () => {} } });
  app.locals.draining=true;
  expect((await request(app).get('/ready')).status).toBe(503);
  expect((await request(app).get('/health')).status).toBe(200);
});
test('production defaults close public registration',() => {
  const prod=loadConfig({ ...env,NODE_ENV:'production',VPN_REQUIRED:'true',DB_NETWORK_TRUSTED:'true',CORS_ORIGINS:'https://admin.test' });
  expect(prod.REGISTRATION_ENABLED).toBe(false);
});
test('websocket gate rejects spoofed source, hostile origins and excess handshakes',() => {
  const config=loadConfig({ ...env,VPN_REQUIRED:'true',AUTH_RATE_LIMIT_MAX:'1' });
  const gate=createSourceGate(config);
  const allowed=(address,headers={}) => { let accepted; gate({ socket:{ remoteAddress:address },headers },(_error,value) => { accepted=value; }); return accepted; };
  expect(allowed('127.0.0.1',{ 'x-forwarded-for':'10.8.0.2' })).toBe(false);
  expect(allowed('10.8.0.2',{ origin:'https://hostile.test' })).toBe(false);
  expect(allowed('10.8.0.2')).toBe(true);
  expect(allowed('10.8.0.2')).toBe(false);
});
