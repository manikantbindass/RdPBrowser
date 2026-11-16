'use strict';

// Confidence describes the observation, not guilt. Thresholds and windows are versioned.
const rules = Object.freeze([
  { id:'auth_failures', events:['auth.failure'], window:300, threshold:5, group:'subject_key', severity:'high', confidence:'medium', explanation:'Five password failures for an account target in five minutes. Typing mistakes and stale saved passwords can trigger this rule.' },
  { id:'password_spray', events:['auth.failure'], window:600, threshold:10, group:'source_hash', distinct:'subject_key', severity:'high', confidence:'medium', explanation:'One source failed authentication for ten account targets in ten minutes. Shared gateways can aggregate unrelated users.' },
  { id:'session_source_change', events:['session.observed'], window:600, threshold:2, group:'session_id', distinct:'source_hash', severity:'medium', confidence:'low', explanation:'A session used multiple sources in ten minutes. Reconnects, roaming and NAT changes can explain this activity.' },
  { id:'device_identifier_change', events:['auth.success'], window:600, threshold:2, group:'subject_key', distinct:'device_hash', severity:'medium', confidence:'low', explanation:'Successful logins asserted different device identifiers in ten minutes. Identifiers are client assertions, not possession proof.' },
  { id:'policy_denials', events:['policy.denied'], window:300, threshold:3, group:'subject_key', severity:'medium', confidence:'medium', explanation:'Three server policy denials in five minutes. A stale client policy or repeated blocked navigation can explain this activity.' },
  { id:'access_volume', events:['session.observed'], window:60, threshold:100, group:'subject_key', severity:'medium', confidence:'low', explanation:'One hundred authenticated HTTP requests in one minute. Automation and administrative activity can be legitimate.' },
  { id:'refresh_reuse', events:['session.refresh_reuse'], window:300, threshold:1, group:'subject_key', severity:'high', confidence:'high', explanation:'A consumed refresh token was reused. Its token family was revoked. Concurrent or retried refreshes can cause reuse.' },
  { id:'vpn_source_rejected', events:['vpn.source_rejected'], window:300, threshold:1, group:'session_id', severity:'high', confidence:'medium', explanation:'A live signed session reached the API outside its approved source network. The request was denied. This does not prove device-wide bypass.' },
  { id:'vpn_client_disconnected', events:['client.vpn_disconnected'], window:300, threshold:1, group:'subject_key', severity:'medium', confidence:'low', explanation:'An authenticated client reported VPN disconnection. Reports may be forged or delayed and do not prove tunnel state.' },
  { id:'vpn_client_bypass', events:['client.vpn_bypass'], window:300, threshold:1, group:'subject_key', severity:'high', confidence:'low', explanation:'An authenticated client reported suspected VPN bypass. Independent packet or gateway evidence is required.' },
].map(rule => Object.freeze({ ...rule, version:1 })));

function evaluate(rule, signals, now = Date.now()) {
  const groups = new Map();
  for (const signal of signals) {
    const time = new Date(signal.created_at).getTime();
    const key = signal[rule.group];
    if (!key || !Number.isFinite(time) || !rule.events.includes(signal.event_type) || time > now || time < now - rule.window * 1000) continue;
    if (rule.distinct && !signal[rule.distinct]) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(signal);
  }
  return [...groups].filter(([, rows]) => (rule.distinct ? new Set(rows.map(row => row[rule.distinct])).size : rows.length) >= rule.threshold)
    .map(([subject, evidence]) => ({ subject, evidence }));
}
module.exports = { rules, evaluate };
