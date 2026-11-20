'use strict';
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { migrate } = require('../src/db/migrations');
const { provision } = require('../src/db/provision');
const { withTenant,DEFAULT_ORGANIZATION:orgA } = require('../src/db/tenant');
const db = require('../src/db/db');
const { createRuntime } = require('../src/runtime');
const { createApp } = require('../src/http/app');
const { loadConfig } = require('../src/config');
const { scanOrganization } = require('../src/services/detection-engine');
const { observe } = require('../src/services/detection-signals');
const url = process.env.INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated _test database required');
const schema = 'detection_' + randomUUID().replaceAll('-','');
const role = 'detection_' + randomUUID().replaceAll('-','');
const roleSecret = randomUUID() + randomUUID();
const orgB = randomUUID();
const owner = new Pool({ connectionString:url });
const scoped = new URL(url); scoped.searchParams.set('options','-c search_path=' + schema + ',public');
const runtimeUrl = new URL(scoped); runtimeUrl.username = role; runtimeUrl.password = roleSecret;
const config = { ...loadConfig({ NODE_ENV:'test',DATABASE_URL:runtimeUrl.toString(),JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),
  VPN_REQUIRED:'false',DEVICE_BINDING_ENABLED:'false',RATE_LIMIT_MAX:'10000',AUTH_RATE_LIMIT_MAX:'1000',MAX_SESSIONS_PER_USER:'10',
  ANOMALY_ORGANIZATION_IDS:orgA + ',' + orgB }), PORT:0 };
const logs = [];
const logger = { info:v => logs.push(v),warn:v => logs.push(v),error:v => logs.push(v) };
let pool,runtime,adminA,adminB,member,memberToken,adminToken,otherToken;
const call = (method,path,token,body) => {
  const req = request(runtime.app)[method]('/api/v1' + path);
  if (token) req.auth(token,{ type:'bearer' });
  return body === undefined ? req : req.send(body);
};
async function login(username,organizationId=orgA,extra={}) {
  const res = await call('post','/auth/login',null,{ username,password:'TestPassword1!',organizationId,...extra });
  expect(res.status).toBe(200); return res.body;
}
const scan = (org=orgA) => withTenant(org,() => scanOrganization(config));
async function failures(count=5) {
  for (let i=0;i<count;i++) expect((await call('post','/auth/login',null,{ username:'memberone',password:'WrongPassword1!' })).status).toBe(401);
}
beforeAll(async () => {
  await owner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
  await owner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
  await owner.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString:scoped.toString() });
  await migrate(pool); await provision(pool,{ role,password:roleSecret,schema });
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[orgB,'Detection B']);
  const hash = await bcrypt.hash('TestPassword1!',4);
  async function user(org,name,role) {
    return (await pool.query('INSERT INTO users(organization_id,username,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [org,name,name + '@test.example',hash,role])).rows[0].id;
  }
  adminA = await user(orgA,'admina','admin'); adminB = await user(orgB,'adminb','admin'); member = await user(orgA,'memberone','user');
  runtime = createRuntime({ config,logger,database:db }); await runtime.start();
  // Manual scans keep database assertions deterministic; worker lifecycle is tested separately.
  config.ANOMALY_DETECTION_ENABLED = true;
  adminToken = (await login('admina')).accessToken;
  otherToken = (await login('adminb',orgB)).accessToken;
  memberToken = (await login('memberone')).accessToken;
});
beforeEach(async () => {
  await pool.query('DELETE FROM incident_reviews'); await pool.query('DELETE FROM detection_evidence');
  await pool.query('DELETE FROM anomaly_alerts'); await pool.query('DELETE FROM detection_signals'); await pool.query('DELETE FROM detection_runs');
});
afterAll(async () => {
  if (runtime) await runtime.stop(); if (pool) await pool.end();
  try { await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await owner.query(`DROP ROLE IF EXISTS ${role}`); }
  finally { await owner.end(); }
});
test('failed authentication persists evidence, concurrent scans deduplicate and repeats do not inflate counts',async () => {
  await failures();
  const scans = await Promise.all([scan(),scan()]);
  expect(scans.flat()).toHaveLength(1);
  const alerts = (await call('get','/admin/alerts',adminToken)).body.alerts;
  expect(alerts).toHaveLength(1); expect(alerts[0]).toMatchObject({ rule_id:'auth_failures',evidence_count:5,confidence:'medium',status:'open' });
  expect(await scan()).toEqual([]);
  const evidence = await call('get','/admin/alerts/' + alerts[0].id + '/evidence?limit=2',adminToken);
  expect(evidence.body.evidence).toHaveLength(2);
  const signals = (await pool.query('SELECT * FROM detection_signals')).rows;
  expect(signals).toHaveLength(7); // Five failures plus two distinct authenticated console requests.
  for (const signal of signals) expect(signal.subject_key).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(signals)).not.toContain('WrongPassword1!'); expect(JSON.stringify(signals)).not.toContain('127.0.0.1');
  const triggered = await pool.query("SELECT * FROM audit_log WHERE action='detection.rule_triggered' AND target=$1",[alerts[0].id]);
  expect(triggered.rows).toHaveLength(1);
});
test('tenant boundaries and ordinary-user permissions protect lists, details, evidence, reviews and responses',async () => {
  await failures(); const [alert] = await scan();
  expect((await call('get','/admin/alerts',otherToken)).body.alerts).toEqual([]);
  for (const suffix of ['', '/evidence','/reviews']) expect((await call('get','/admin/alerts/' + alert.id + suffix,otherToken)).status).toBe(404);
  for (const [method,suffix,body] of [['patch','/review',{ revision:1,status:'investigating',disposition:'pending' }],['post','/respond',{ revision:1,action:'lock_user' }]]) {
    expect((await call(method,'/admin/alerts/' + alert.id + suffix,otherToken,body)).status).toBe(404);
    expect((await call(method,'/admin/alerts/' + alert.id + suffix,memberToken,body)).status).toBe(403);
  }
  await withTenant(orgB,async () => {
    expect((await db.query('SELECT * FROM detection_evidence')).rows).toEqual([]);
    await expect(db.query('INSERT INTO incident_reviews(incident_id,actor_id,status,disposition,revision) VALUES($1,$2,$3,$4,1)',[alert.id,adminB,'open','pending'])).rejects.toMatchObject({ code:'23503' });
  });
  expect((await call('get','/admin/alerts?limit=101',adminToken)).status).toBe(400);
});
test('review revisions reject races; consumed evidence cannot reopen closed incidents',async () => {
  await failures(); const [alert] = await scan();
  const reviews = await Promise.all([1,2].map(() => call('patch','/admin/alerts/' + alert.id + '/review',adminToken,{ revision:1,status:'investigating',disposition:'pending' })));
  expect(reviews.map(res => res.status).sort()).toEqual([200,409]);
  expect((await call('patch','/admin/alerts/' + alert.id + '/review',adminToken,{ revision:2,status:'resolved',disposition:'pending' })).status).toBe(400);
  expect((await call('patch','/admin/alerts/' + alert.id + '/review',adminToken,{ revision:2,status:'resolved',disposition:'benign' })).status).toBe(200);
  expect(await scan()).toEqual([]);
  await failures(); const [next] = await scan(); expect(next.id).not.toBe(alert.id);
  expect((await call('patch','/admin/alerts/' + alert.id + '/review',adminToken,{ revision:3,status:'open',disposition:'pending' })).status).toBe(409);
  await withTenant(orgA,async () => {
    await expect(db.query('DELETE FROM detection_evidence WHERE incident_id=$1',[alert.id])).rejects.toMatchObject({ code:'42501' });
    await expect(db.query('UPDATE incident_reviews SET disposition=$1 WHERE incident_id=$2',['confirmed',alert.id])).rejects.toMatchObject({ code:'42501' });
  });
});
test('client reports remain low confidence, use ingestion time, and replays do not add observations',async () => {
  const body = { clientEventId:randomUUID(),eventType:'vpn.disconnected',severity:'critical',occurredAt:new Date(Date.now()-86400000).toISOString() };
  expect((await call('post','/events',memberToken,body)).status).toBe(201);
  expect((await call('post','/events',memberToken,body)).status).toBe(201);
  const [alert] = await scan();
  const detail = (await call('get','/admin/alerts/' + alert.id,adminToken)).body.alert;
  expect(detail).toMatchObject({ rule_id:'vpn_client_disconnected',confidence:'low',severity:'medium',evidence_count:1 });
  expect((await call('get','/admin/alerts/' + alert.id + '/evidence',adminToken)).body.evidence[0].trust).toBe('client_report');
});
test('source gate only attributes live signed sessions and always denies outside-network requests',async () => {
  const gated = createApp({ config:{ ...config,VPN_REQUIRED:true,VPN_SOURCE_MODE:'tunnel' },logger,database:db });
  expect((await request(gated).get('/api/v1/admin/stats').auth('invalid',{ type:'bearer' })).status).toBe(403);
  expect(await scan()).toEqual([]);
  expect((await request(gated).get('/api/v1/auth/status').auth(memberToken,{ type:'bearer' })).status).toBe(403);
  const [alert] = await scan(); expect(alert.ruleId).toBe('vpn_source_rejected');
  const detail = (await call('get','/admin/alerts/' + alert.id,adminToken)).body.alert;
  expect(detail.session_id).toBeTruthy();
  const response = await call('post','/admin/alerts/' + alert.id + '/respond',adminToken,{ revision:1,action:'terminate_session' });
  expect(response.status).toBe(200);
  expect((await call('get','/auth/status',memberToken)).status).toBe(401);
  memberToken = (await login('memberone')).accessToken;
});
test('manual lock revokes sessions and cannot escalate against a peer administrator',async () => {
  await failures(); const [alert] = await scan();
  expect((await call('post','/admin/alerts/' + alert.id + '/respond',adminToken,{ revision:1,action:'lock_user' })).status).toBe(200);
  expect((await call('get','/auth/status',memberToken)).status).toBe(401);
  expect((await pool.query('SELECT is_locked FROM users WHERE id=$1',[member])).rows[0].is_locked).toBe(true);
  await pool.query('UPDATE users SET is_locked=FALSE WHERE id=$1',[member]); memberToken = (await login('memberone')).accessToken;
  const peer = (await pool.query("INSERT INTO anomaly_alerts(organization_id,user_id,alert_type,severity) VALUES($1,$2,'fixture','high') RETURNING id",[orgA,adminA])).rows[0];
  expect((await call('post','/admin/alerts/' + peer.id + '/respond',adminToken,{ revision:1,action:'lock_user' })).status).toBe(403);
  expect((await call('get','/admin/alerts/' + peer.id + '/reviews',adminToken)).body.reviews).toEqual([]);
});
test('rule writes roll back atomically on evidence failure and health exposes disabled or unstarted workers',async () => {
  await failures();
  await pool.query("CREATE FUNCTION fail_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$");
  await pool.query('CREATE TRIGGER fail_evidence BEFORE INSERT ON detection_evidence FOR EACH ROW EXECUTE FUNCTION fail_evidence()');
  try { await expect(scan()).rejects.toThrow('fixture failure'); } finally { await pool.query('DROP TRIGGER fail_evidence ON detection_evidence'); }
  expect((await pool.query('SELECT * FROM anomaly_alerts')).rows).toEqual([]);
  expect((await scan())).toHaveLength(1);
  expect((await call('get','/admin/detection-rules',adminToken)).body.health).toBe('healthy');
  config.ANOMALY_DETECTION_ENABLED = false;
  expect((await call('get','/admin/detection-rules',adminToken)).body.health).toBe('disabled');
  config.ANOMALY_DETECTION_ENABLED = true;
});
test('password-device changes, server URL denials and refresh reuse feed the engine',async () => {
  await login('memberone',orgA,{ deviceId:'asserted-one' }); await login('memberone',orgA,{ deviceId:'asserted-two' });
  expect((await scan()).map(alert => alert.ruleId)).toContain('device_identifier_change');
  await call('post','/admin/blocked-urls',adminToken,{ pattern:'blocked.test' });
  for (let i=0;i<3;i++) expect((await call('post','/proxy/navigate',memberToken,{ url:'https://blocked.test/secret?token=hidden' })).status).toBe(403);
  expect((await scan()).map(alert => alert.ruleId)).toContain('policy_denials');
  const tokens = await login('memberone');
  expect((await call('post','/auth/refresh',null,{ refreshToken:tokens.refreshToken })).status).toBe(200);
  expect((await call('post','/auth/refresh',null,{ refreshToken:tokens.refreshToken })).status).toBe(401);
  expect((await scan()).map(alert => alert.ruleId)).toContain('refresh_reuse');
  expect(JSON.stringify(logs)).not.toContain(tokens.refreshToken); expect(JSON.stringify(logs)).not.toContain('TestPassword1!');
});
test('retention removes minimal raw signals but retains evidence',async () => {
  const req={ app:{ locals:{ config } },ip:'192.0.2.1',requestId:randomUUID(),user:{ sub:member } };
  const opened=await withTenant(orgA,() => db.transaction(async () => {
    // The observation and scan share a PostgreSQL transaction timestamp.
    await observe(req,'client.vpn_bypass',{ trust:'client_report' });
    return scanOrganization(config);
  }));
  expect(opened).toHaveLength(1);
  const [alert]=opened;
  await pool.query("UPDATE detection_signals SET created_at=NOW()-INTERVAL '8 days'"); await scan();
  expect((await pool.query('SELECT * FROM detection_signals')).rows).toEqual([]);
  expect((await pool.query('SELECT * FROM detection_evidence WHERE incident_id=$1',[alert.id])).rows).toHaveLength(1);
});
test('bounded overload is visible and an actual scan records observation-to-detection latency',async () => {
  await pool.query(`INSERT INTO detection_signals(organization_id,user_id,event_type,subject_key,source_hash,trust,request_id)
    SELECT $1,$2,'session.observed','synthetic-load-subject','synthetic-load-source','server_observed',uuid_generate_v4() FROM generate_series(1,2001)`,[orgA,member]);
  const start=Date.now(); const alerts=await scan(); const scanMs=Date.now()-start;
  expect(alerts.map(alert => alert.ruleId)).toEqual(['access_volume']);
  expect((await call('get','/admin/detection-rules',adminToken)).body.health).toBe('capacity_exceeded');
  const result=(await pool.query(`SELECT evidence_count,EXTRACT(EPOCH FROM (created_at-first_seen))*1000 AS latency_ms
    FROM anomaly_alerts WHERE id=$1`,[alerts[0].id])).rows[0];
  expect(result.evidence_count).toBe(2000); expect(Number(result.latency_ms)).toBeGreaterThanOrEqual(0);
  expect(scanMs).toBeLessThan(15000);
  console.info(JSON.stringify({ event:'synthetic_load_evaluation',signals:2001,scanMs,observationToIncidentMs:Number(result.latency_ms) }));
});
test('legacy resolution retains its audit action and records a consistent incident review',async () => {
  await failures(); const [alert]=await scan();
  expect((await request(runtime.app).patch('/api/admin/anomalies/' + alert.id + '/resolve').auth(adminToken,{ type:'bearer' })).status).toBe(200);
  const resolved=(await call('get','/admin/alerts/' + alert.id,adminToken)).body.alert;
  expect(resolved).toMatchObject({ resolved:true,status:'resolved',disposition:'insufficient_evidence',review_revision:2 });
  expect((await pool.query("SELECT action FROM audit_log WHERE action='anomaly.resolve' AND target=$1",[alert.id])).rows).toHaveLength(1);
  expect((await call('get','/admin/alerts/' + alert.id + '/reviews',adminToken)).body.reviews).toHaveLength(1);
});
test('detection write failure cannot roll back refresh-family revocation',async () => {
  const tokens=await login('memberone');
  const refreshed=await call('post','/auth/refresh',null,{ refreshToken:tokens.refreshToken });
  expect(refreshed.status).toBe(200);
  await pool.query("CREATE FUNCTION fail_reuse_signal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture telemetry failure'; END $$");
  await pool.query("CREATE TRIGGER fail_reuse_signal BEFORE INSERT ON detection_signals FOR EACH ROW WHEN (NEW.event_type='session.refresh_reuse') EXECUTE FUNCTION fail_reuse_signal()");
  try {
    expect((await call('post','/auth/refresh',null,{ refreshToken:tokens.refreshToken })).status).toBe(401);
    expect((await call('get','/auth/status',refreshed.body.accessToken)).status).toBe(401);
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ event:'detection.reuse_observation_failed' })]));
  } finally { await pool.query('DROP TRIGGER fail_reuse_signal ON detection_signals'); }
});
