'use strict';
const { createHash }=require('node:crypto');
const { query }=require('../db/db');
const { withTenant }=require('../db/tenant');
const { fail }=require('./validation');
function fingerprint(provider) {
  return createHash('sha256').update(JSON.stringify({ id:provider.id,issuer:provider.issuer,clientId:provider.clientId,
    redirectUri:provider.redirectUri,secretHash:createHash('sha256').update(provider.clientSecret).digest('hex'),
    acr:provider.mfaAcrValues,amr:provider.mfaAmrValues,age:provider.maxAuthenticationAgeSeconds,
    kind:provider.kind || 'generic',binding:provider.provisioningSubjectClaim || 'none',requireActivation:!!provider.requireActivation })).digest('hex');
}
async function assertEnabled(provider) {
  await withTenant(provider.organizationId,async()=>{
    const row=(await query('SELECT * FROM oidc_settings WHERE provider_id=$1',[provider.id])).rows[0];
    if ((!row && provider.requireActivation) || (row && (!row.enabled || row.configuration_hash!==fingerprint(provider)))) fail(403,'Provider is disabled or requires configuration validation','OIDC_CONFIGURATION_REQUIRED');
  });
}
async function assertSessionProvider(config,organizationId,providerId) {
  if (!providerId) return; // Sessions issued before migration 006 have no provider tag.
  const provider=config.oidcProviders.find(candidate=>candidate.id===providerId && candidate.organizationId===organizationId);
  if (!provider) fail(401,'Enterprise provider configuration changed','OIDC_PROVIDER_CHANGED');
  await assertEnabled(provider);
}
module.exports={ fingerprint,assertEnabled,assertSessionProvider };
