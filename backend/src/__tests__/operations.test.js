'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const request=require('supertest');
const {loadConfig}=require('../config');
const {loadDatabaseConfig}=require('../db/config');
const {secretValue}=require('../services/secret-files');
const {createApp}=require('../http/app');
const {startOperations,statusFile}=require('../operations/server');
const {databaseSpan}=require('../operations/trace');
const env={NODE_ENV:'test',DATABASE_URL:'postgresql://local:local@localhost/test',JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),VPN_REQUIRED:'false'};
const logger={info:jest.fn(),warn:jest.fn(),error:jest.fn()};
let directory;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'rsx-operations-'));jest.clearAllMocks();});
afterEach(()=>fs.rmSync(directory,{recursive:true,force:true}));
test('file secrets load without exposing values and reject conflicting, missing or multiline sources',()=>{
  const file=path.join(directory,'secret');fs.writeFileSync(file,'private-fixture\n');
  expect(secretValue({JWT_SECRET_FILE:file},'JWT_SECRET')).toBe('private-fixture');
  expect(()=>secretValue({JWT_SECRET:'conflict',JWT_SECRET_FILE:file},'JWT_SECRET')).toThrow('Invalid secret source');
  expect(()=>secretValue({JWT_SECRET_FILE:'relative'},'JWT_SECRET')).toThrow('Invalid secret source');
  fs.writeFileSync(file,'private-fixture\nsecond');
  expect(()=>secretValue({JWT_SECRET_FILE:file},'JWT_SECRET')).toThrow('Cannot read secret file for JWT_SECRET');
  expect(()=>secretValue({JWT_SECRET_FILE:path.join(directory,'missing')},'JWT_SECRET')).toThrow('Cannot read secret');
});
test('migration configuration needs no identity keys and enforces explicit database trust',()=>{
  expect(loadDatabaseConfig({DATABASE_URL:env.DATABASE_URL,NODE_ENV:'production',DB_NETWORK_TRUSTED:'true'})).not.toHaveProperty('JWT_SECRET');
  expect(()=>loadDatabaseConfig({DATABASE_URL:env.DATABASE_URL,NODE_ENV:'production'})).toThrow('network trust');
  expect(()=>loadDatabaseConfig({DATABASE_URL:env.DATABASE_URL,DB_NETWORK_TRUSTED:'maybe'})).toThrow('Invalid database');
  expect(()=>loadDatabaseConfig({DATABASE_URL:env.DATABASE_URL+'?sslmode=no-verify'})).toThrow('explicit database TLS');
});
test.each([{METRICS_ENABLED:'true'},{METRICS_ENABLED:'true',METRICS_TOKEN:'x'.repeat(64),METRICS_PORT:'3001'},{DB_POOL_MAX:'51'},{TRACE_SAMPLE_RATE:'2'},{SHUTDOWN_GRACE_MS:'50000'}])('rejects unsafe operations settings %p',override=>{
  expect(()=>loadConfig({...env,...override})).toThrow();
});
test('draining rejects mutations and preserves liveness while readiness fails',async()=>{
  const app=createApp({config:loadConfig(env),logger,database:{checkReady:async()=>{}}});app.locals.draining=true;
  expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(503);
  expect((await request(app).get('/ready')).status).toBe(503);
  expect((await request(app).get('/health')).status).toBe(200);
});
test('metrics authenticate, traces correlate without raw inputs, dashboard has no stored credentials',async()=>{
  const config={...loadConfig({...env,METRICS_ENABLED:'true',METRICS_TOKEN:'x'.repeat(64),TRACE_SAMPLE_RATE:'1',OPERATIONS_STATUS_DIRECTORY:directory}),METRICS_PORT:0};
  const app=require('express')();
  app.locals.telemetry=require('../operations/telemetry').createTelemetry(config,logger);
  app.use(app.locals.telemetry.middleware);
  app.get('/fixture/:id',async(req,res)=>{await databaseSpan(async()=>({private:'not-logged'}));res.json({ok:true});});
  const telemetry=app.locals.telemetry;
  const operations=startOperations({config,app,telemetry,database:{getPool:()=>({totalCount:1})},logger});
  await operations.ready;
  // Query the bound server through an exported test address, never a production port.
  try {
    const api=await request(app).get('/fixture/private-value?token=private-value').set('traceparent','00-'+'a'.repeat(32)+'-'+'b'.repeat(16)+'-01');
    expect(api.headers.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(api.headers.traceparent).not.toContain('a'.repeat(32));
    const address=operations.address();
    expect((await request(address).get('/metrics')).status).toBe(401);
    expect((await request(address).get('/metrics').auth('z'.repeat(64),{type:'bearer'})).status).toBe(401);
    const metrics=await request(address).get('/metrics').auth(config.METRICS_TOKEN,{type:'bearer'});
    expect(metrics.text).toContain('route="/fixture/:id"');expect(metrics.text).toContain('rsx_database_queries_total 1');
    expect(metrics.text).not.toContain('private-value');
    expect((await request(address).get('/status').auth(config.METRICS_TOKEN,{type:'bearer'})).body.observer.state).toBe('unavailable');
    const dashboard=await request(address).get('/dashboard.js');expect(dashboard.status).toBe(200);expect(dashboard.text).not.toMatch(/localStorage|sessionStorage/);
    expect((await request(address).post('/status')).status).toBe(405);
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/private-value|not-logged/);
    expect(logger.info.mock.calls.some(([row])=>row.name==='db.query')).toBe(true);
  } finally {telemetry.close();await operations.close();}
});
test('observer feed distinguishes stale, missing and oversized reports',()=>{
  const file=path.join(directory,'alerts.json');fs.writeFileSync(file,'{}');
  expect(statusFile(directory,'alerts.json',1000).state).toBe('fresh');
  fs.utimesSync(file,1,1);expect(statusFile(directory,'alerts.json',1000).state).toBe('stale');
  fs.writeFileSync(file,'x'.repeat(65537));expect(statusFile(directory,'alerts.json',1000).state).toBe('unavailable');
});
test('disconnect prevents an outstanding dashboard response from revealing data',async()=>{
  const nodes=new Map();
  for(const id of ['connect','disconnect','snapshot','token','cards','alerts','recovery','message']) nodes.set(id,{hidden:id==='snapshot',value:'x'.repeat(64),addEventListener:(name,handler)=>{nodes.get(id)[name]=handler;},replaceChildren:jest.fn()});
  let complete;
  const pending=new Promise(resolve=>{complete=resolve;});
  const sandbox={document:{getElementById:id=>nodes.get(id)},fetch:()=>pending,setInterval:()=>1,clearInterval:()=>{}};
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname,'../operations/public/dashboard.js'),'utf8'),sandbox);
  nodes.get('connect').submit({preventDefault:()=>{}});
  nodes.get('disconnect').click();
  complete({ok:true,json:async()=>({})});
  await new Promise(resolve=>setImmediate(resolve));
  expect(nodes.get('snapshot').hidden).toBe(true);
  expect(nodes.get('connect').hidden).toBe(false);
  expect(nodes.get('message').textContent).toBe('Disconnected');
});
