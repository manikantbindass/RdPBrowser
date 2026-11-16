'use strict';
const { randomBytes,randomUUID }=require('node:crypto');
const { sign,verify,retryDelay }=require('../services/webhook-contract');
const { loadConfig }=require('../config');
const { digest }=require('../services/evidence');
const S=require('../services/scim-schema');
const env={ NODE_ENV:'test',DATABASE_URL:'postgresql://test:local@localhost/test',JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),VPN_REQUIRED:'false' };
test('SCIM requires explicit HTTPS public deployment address and keeps scope disabled by default',()=>{
  expect(loadConfig(env).SCIM_ENABLED).toBe(false);
  expect(()=>loadConfig({ ...env,SCIM_PUBLIC_BASE_URL:'https://scim.example.test/scim/v2?secret=hidden' })).toThrow('SCIM_PUBLIC_BASE_URL');
  expect(()=>loadConfig({ ...env,NODE_ENV:'production',VPN_REQUIRED:'true',DB_NETWORK_TRUSTED:'true',CORS_ORIGINS:'https://app.test',SCIM_ENABLED:'true' })).toThrow('SCIM_PUBLIC_BASE_URL');
});
test('fixture inputs accept declared provider compatibility fields but never tenant or role claims',()=>{
  const core={ schemas:[S.USER],userName:'employee@fixture.test',emails:[{ value:'employee@fixture.test' }] };
  expect(S.userValue({ ...core,locale:'en-US',password:'ignored-example',groups:[] })).toMatchObject({ active:true });
  expect(()=>S.userValue({ ...core,role:'superadmin' })).toThrow();
  expect(()=>S.userValue({ ...core,organizationId:randomUUID() })).toThrow();
  expect(()=>S.filter('userName eq "valid" or active eq true','Users')).toThrow();
});
test('evidence digest is stable over JSON key ordering and serialized database timestamps',()=>{
  expect(digest([{ z:new Date('2026-11-16T12:00:00Z'),a:{ y:2,x:1 } }])).toBe(digest([{ a:{ x:1,y:2 },z:'2026-11-16T12:00:00.000Z' }]));
});
test('webhook signing binds timestamp, event identity and exact bytes and rejects stale signatures',()=>{
  const secret=randomBytes(32),eventId=randomUUID(),timestamp=1000,body=Buffer.from('{"type":"access.changed"}');
  const signature=sign(body,secret,timestamp,eventId);
  const headers={ timestamp,eventId,signature };
  expect(verify(body,secret,headers,1001)).toBe(true);
  expect(verify(body,secret,headers,1301)).toBe(false);
  expect(verify(body,secret,{ ...headers,eventId:randomUUID() },1001)).toBe(false);
  expect(verify(Buffer.concat([body,Buffer.from(' ')]),secret,headers,1001)).toBe(false);
  expect(retryDelay(8,1)).toBeGreaterThan(retryDelay(1,0));
  expect(()=>retryDelay(9,0)).toThrow('Invalid retry');
});
