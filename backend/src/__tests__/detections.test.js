'use strict';
const { rules,evaluate } = require('../../../security/anomaly-detector/rules');
const { fixtures,now } = require('../../../security/anomaly-detector/fixtures');
const { run } = require('../../../scripts/evaluate-detections.cjs');
const { loadConfig } = require('../config');
test.each(fixtures.map(fixture => [fixture.name,fixture]))('%s', (_name, fixture) => {
  expect(evaluate(rules.find(rule => rule.id === fixture.ruleId),fixture.signals,now).length > 0).toBe(fixture.expectAlert);
});
test('synthetic evaluation reports known confounders and missing telemetry honestly', () => {
  expect(run()).toMatchObject({ cases:50,truePositive:10,trueNegative:20,falsePositive:10,falseNegative:10,precision:0.5,recall:0.5 });
});
test('future events and absent distinct values cannot meet a threshold', () => {
  const rule = rules.find(rule => rule.id === 'device_identifier_change');
  const rows = fixtures.find(fixture => fixture.ruleId === rule.id).signals;
  expect(evaluate(rule,rows.map(row => ({ ...row,created_at:new Date(now + 1) })),now)).toEqual([]);
  expect(evaluate(rule,rows.map(row => ({ ...row,device_hash:null })),now)).toEqual([]);
});
test('worker bounds are configuration-validated', () => {
  const env={ NODE_ENV:'test',DATABASE_URL:'postgresql://test:local@localhost/test',JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),VPN_REQUIRED:'false' };
  expect(() => loadConfig({ ...env,DETECTION_INTERVAL_MS:'0' })).toThrow('DETECTION_INTERVAL_MS');
  expect(() => loadConfig({ ...env,DETECTION_SIGNAL_RETENTION_DAYS:'31' })).toThrow('DETECTION_SIGNAL_RETENTION_DAYS');
});
