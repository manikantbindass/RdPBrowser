'use strict';
const { rules } = require('./rules');
const now = Date.parse('2026-11-16T12:00:00Z');
function observations(rule) {
  return Array.from({ length:rule.threshold }, (_, i) => ({
    id:'synthetic-' + i, event_type:rule.events[0], subject_key:'synthetic-account', session_id:'synthetic-session',
    source_hash:rule.distinct === 'source_hash' ? 'source-' + i : 'synthetic-source',
    device_hash:rule.distinct === 'device_hash' ? 'device-' + i : 'synthetic-device',
    created_at:new Date(now - 1000 - 100 * (rule.threshold - i - 1)).toISOString(),
    ...(rule.distinct === 'subject_key' ? { subject_key:'account-' + i } : {}),
  }));
}
// Deliberately includes confounders and missing telemetry. These are stress cases,
// not a representative dataset or a measured production false-positive rate.
const fixtures = rules.flatMap(rule => {
  const rows = observations(rule);
  return [
    { name:rule.id + ': observed attack', ruleId:rule.id, attack:true, expectAlert:true, signals:rows },
    { name:rule.id + ': below threshold benign activity', ruleId:rule.id, attack:false, expectAlert:false, signals:rows.slice(1) },
    { name:rule.id + ': expired observations', ruleId:rule.id, attack:false, expectAlert:false,
      signals:rows.map(row => ({ ...row,created_at:new Date(now - (rule.window + 1) * 1000).toISOString() })) },
    { name:rule.id + ': legitimate activity with same observations', ruleId:rule.id, attack:false, expectAlert:true, signals:rows },
    { name:rule.id + ': attack without collected telemetry', ruleId:rule.id, attack:true, expectAlert:false, signals:[] },
  ];
});
module.exports = { fixtures, now };
