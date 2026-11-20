'use strict';
jest.mock('../db/db',() => ({ query:jest.fn() }));
jest.mock('../services/detection-engine',() => ({ scanOrganization:jest.fn() }));
const { scanOrganization }=require('../services/detection-engine');
const { query }=require('../db/db');
const { tenantId,DEFAULT_ORGANIZATION }=require('../db/tenant');
const { startAnomalyDetector }=require('../../../security/anomaly-detector/detector');
beforeEach(() => { query.mockReset(); scanOrganization.mockReset(); });
test('worker shutdown waits for in-flight tenant work and does not open another tenant',async () => {
  let unblock;
  const tenants=[];
  scanOrganization.mockImplementation(() => { tenants.push(tenantId()); return Promise.resolve([]); });
  scanOrganization.mockImplementationOnce(() => { tenants.push(tenantId()); return new Promise(resolve => { unblock=resolve; }); });
  const stop=startAnomalyDetector({ emitToAdmins:async () => {} },{ info() {},error() {} },{ DETECTION_INTERVAL_MS:30000,ANOMALY_ORGANIZATION_IDS:DEFAULT_ORGANIZATION+',11111111-1111-4111-8111-111111111111' });
  let closed=false;
  const pending=stop().then(() => { closed=true; });
  await Promise.resolve(); expect(closed).toBe(false);
  unblock([]); await pending;
  expect(closed).toBe(true); expect(new Set(tenants)).toEqual(new Set([DEFAULT_ORGANIZATION]));
});

test('scan failure records unhealthy status and never emits fabricated alerts',async () => {
  scanOrganization.mockRejectedValue(new Error('fixture database failure'));
  query.mockResolvedValue({ rows:[] });
  const emitToAdmins=jest.fn(); const logger={ info:jest.fn(),error:jest.fn() };
  const stop=startAnomalyDetector({ emitToAdmins },logger,{ DETECTION_INTERVAL_MS:30000,ANOMALY_ORGANIZATION_IDS:DEFAULT_ORGANIZATION });
  await stop();
  expect(logger.error).toHaveBeenCalledWith({ event:'detection.scan_failed',organizationId:DEFAULT_ORGANIZATION });
  expect(query.mock.calls[0][0]).toContain("VALUES(NOW(),'failed')");
  expect(emitToAdmins).not.toHaveBeenCalled();
});

test('new incidents notify only their tenant and delivery failure does not roll back the incident',async () => {
  const alert={ id:'fixture',ruleId:'auth_failures',severity:'high' };
  scanOrganization.mockResolvedValue([alert]);
  const emitToAdmins=jest.fn().mockRejectedValue(new Error('fixture disconnected transport'));
  const logger={ info:jest.fn(),error:jest.fn(),warn:jest.fn() };
  const stop=startAnomalyDetector({ emitToAdmins },logger,{ DETECTION_INTERVAL_MS:30000,ANOMALY_ORGANIZATION_IDS:DEFAULT_ORGANIZATION });
  await stop();
  expect(emitToAdmins).toHaveBeenCalledTimes(1);
  expect(emitToAdmins).toHaveBeenCalledWith(DEFAULT_ORGANIZATION,'security_alert',alert);
  expect(logger.warn).toHaveBeenCalledWith({ event:'detection.notification_failed',organizationId:DEFAULT_ORGANIZATION });
});
