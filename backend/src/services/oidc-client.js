'use strict';
// Native Node22+ ESM interoperability; protocol tests execute this in Node rather than Jest's CJS loader.
async function createOidcClient(provider,customFetch) {
  const client=require('openid-client');
  const options={ timeout:5 };
  if (customFetch) options[client.customFetch]=customFetch;
  const config=await client.discovery(new URL(provider.issuer),provider.clientId,{ id_token_signed_response_alg:'RS256' },
    client.ClientSecretPost(provider.clientSecret),options);
  client.enableNonRepudiationChecks(config);
  return {
    inspect() {
      const metadata=config.serverMetadata();
      const https=value=>{ try { const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.hash; } catch { return false; } };
      return { issuer:metadata.issuer,checks:{ issuer:metadata.issuer===provider.issuer,
        authorizationEndpoint:https(metadata.authorization_endpoint),tokenEndpoint:https(metadata.token_endpoint),jwks:https(metadata.jwks_uri),
        code:metadata.response_types_supported?.includes('code')===true,rs256:metadata.id_token_signing_alg_values_supported?.includes('RS256')===true,
        pkceS256:metadata.code_challenge_methods_supported?.includes('S256')===true,
        clientSecretPost:metadata.token_endpoint_auth_methods_supported?.includes('client_secret_post')===true } };
    },
    async start({ verifier,nonce,state }) {
      return client.buildAuthorizationUrl(config,{ response_type:'code',response_mode:'query',scope:provider.provisioningSubjectClaim==='oid' ? 'openid profile' : 'openid',redirect_uri:provider.redirectUri,
        code_challenge:await client.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce,
        max_age:String(provider.maxAuthenticationAgeSeconds),...(provider.mfaAcrValues.length ? { acr_values:provider.mfaAcrValues.join(' ') } : {}) }).toString();
    },
    async finish(callback,{ verifier,nonce,state }) {
      const tokens=await client.authorizationCodeGrant(config,new URL(callback),{ pkceCodeVerifier:verifier,expectedState:state,
        expectedNonce:nonce,idTokenExpected:true,maxAge:provider.maxAuthenticationAgeSeconds });
      const claims=tokens.claims();
      if (!claims || typeof claims.sub!=='string' || !claims.sub || claims.sub.length>255 || !Number.isFinite(claims.auth_time)) throw new Error('Invalid identity claims');
      const mfa=(provider.mfaAcrValues.includes(claims.acr) || (Array.isArray(claims.amr) && provider.mfaAmrValues.some(v => claims.amr.includes(v))));
      let provisionedSubject=null;
      if (provider.provisioningSubjectClaim==='sub') provisionedSubject=claims.sub;
      if (provider.provisioningSubjectClaim==='oid') {
        const tenant=new URL(provider.issuer).pathname.split('/')[1];
        const uuid=require('../db/tenant').uuid;
        if (provider.kind!=='entra' || typeof claims.tid!=='string' || claims.tid.toLowerCase()!==tenant.toLowerCase() || !uuid.test(claims.oid || '')) throw new Error('Invalid directory identity claims');
        provisionedSubject=claims.oid.toLowerCase();
      }
      return { issuer:claims.iss,subject:claims.sub,provisionedSubject,mfaVerified:mfa,authenticatedAt:new Date(claims.auth_time*1000) };
    },
  };
}
module.exports={ createOidcClient };
