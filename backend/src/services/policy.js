'use strict';
const { query } = require('../db/db');
const { tenantId } = require('../db/tenant');
const { fail } = require('./validation');
function matches(pattern, url) {
  // Literal segments, no regular-expression engine or exponential backtracking.
  const parts=pattern.toLowerCase().split('*');
  const glob=value => {
    value=value.toLowerCase();
    if (parts.length===1) return value===parts[0];
    if (!value.startsWith(parts[0])) return false;
    let position=parts[0].length;
    for (const part of parts.slice(1,-1)) {
      const found=value.indexOf(part,position);
      if (found<0) return false;
      position=found+part.length;
    }
    const last=parts[parts.length-1];
    return value.endsWith(last) && value.length-last.length>=position;
  };
  return glob(url.hostname) || glob(url.href);
}
async function evaluate(urlString) {
  let url;
  try { url=new URL(urlString); } catch { fail(400,'Invalid URL'); }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) fail(400,'Only HTTP(S) URLs without credentials are supported');
  const organizationId=tenantId();
  const [policies,blocked,allowed]=await Promise.all([
    query('SELECT id,revision,rules FROM policies WHERE organization_id=$1 AND is_active ORDER BY id LIMIT 101',[organizationId]),
    query('SELECT pattern FROM blocked_urls WHERE organization_id=$1 AND is_active LIMIT 1001',[organizationId]),
    query('SELECT pattern FROM allowed_urls WHERE organization_id=$1 AND is_active LIMIT 1001',[organizationId]),
  ]);
  if (policies.rows.length>100 || blocked.rows.length>1000 || allowed.rows.length>1000) fail(503,'Policy capacity exceeded');
  const deny=[...blocked.rows.map(r => r.pattern),...policies.rows.flatMap(r => r.rules.deny)];
  const allowGroups=[allowed.rows.map(r => r.pattern),...policies.rows.map(r => r.rules.allow)].filter(r => r.length);
  const denied=deny.some(p => matches(p,url));
  const permitted=allowGroups.every(group => group.some(p => matches(p,url)));
  return { allowed:!denied && permitted,url:urlString,reason:denied ? 'deny_rule' : (!permitted ? 'allow_rule_required' : 'permitted'),
    policies:policies.rows.map(r => ({ id:r.id,revision:r.revision })),enforcement:'control-plane-decision' };
}
module.exports={ evaluate,matches };
