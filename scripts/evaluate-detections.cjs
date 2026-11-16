'use strict';
const { performance } = require('node:perf_hooks');
const { rules, evaluate } = require('../security/anomaly-detector/rules');
const { fixtures, now } = require('../security/anomaly-detector/fixtures');
function run() {
  const counts = { truePositive:0, trueNegative:0, falsePositive:0, falseNegative:0 };
  const latencies = [];
  const start = performance.now();
  for (const fixture of fixtures) {
    const rule = rules.find(rule => rule.id === fixture.ruleId);
    const detected = evaluate(rule, fixture.signals, now).length > 0;
    counts[fixture.attack ? detected ? 'truePositive' : 'falseNegative' : detected ? 'falsePositive' : 'trueNegative']++;
    if (detected) latencies.push(now - Math.max(...fixture.signals.map(row => new Date(row.created_at).getTime())));
  }
  return { dataset:'synthetic deterministic stress cases v1; not population estimates', cases:fixtures.length, ...counts,
    precision:counts.truePositive / (counts.truePositive + counts.falsePositive), recall:counts.truePositive / (counts.truePositive + counts.falseNegative),
    falsePositiveRate:counts.falsePositive / (counts.falsePositive + counts.trueNegative),
    falseNegativeRate:counts.falseNegative / (counts.falseNegative + counts.truePositive),
    modeledObservationToScanLatencyMs:Math.max(...latencies), evaluationDurationMs:Math.round((performance.now() - start) * 1000) / 1000 };
}
if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
