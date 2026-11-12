'use strict';
jest.mock('../db/db',() => ({ query:jest.fn() }));
const { query }=require('../db/db');
const { tenantId,DEFAULT_ORGANIZATION }=require('../db/tenant');
const { startAnomalyDetector }=require('../../../security/anomaly-detector/detector');
test('worker shutdown waits for in-flight tenant work and does not open another tenant',async () => {
  let unblock;
  const tenants=[];
  query.mockImplementation(() => { tenants.push(tenantId()); return Promise.resolve({ rows:[{ count:'0' }] }); });
  query.mockImplementationOnce(() => { tenants.push(tenantId()); return new Promise(resolve => { unblock=resolve; }); });
  const stop=startAnomalyDetector({ emitToAdmins:async () => {} },{ info() {},error() {} },{ ANOMALY_ORGANIZATION_IDS:DEFAULT_ORGANIZATION+',11111111-1111-4111-8111-111111111111' });
  let closed=false;
  const pending=stop().then(() => { closed=true; });
  await Promise.resolve(); expect(closed).toBe(false);
  unblock({ rows:[] }); await pending;
  expect(closed).toBe(true); expect(new Set(tenants)).toEqual(new Set([DEFAULT_ORGANIZATION]));
});
