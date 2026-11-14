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
    async start({ verifier,nonce,state }) {
      return client.buildAuthorizationUrl(config,{ response_type:'code',response_mode:'query',scope:'openid',redirect_uri:provider.redirectUri,
        code_challenge:await client.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce,
        max_age:String(provider.maxAuthenticationAgeSeconds),...(provider.mfaAcrValues.length ? { acr_values:provider.mfaAcrValues.join(' ') } : {}) }).toString();
    },
    async finish(callback,{ verifier,nonce,state }) {
      const tokens=await client.authorizationCodeGrant(config,new URL(callback),{ pkceCodeVerifier:verifier,expectedState:state,
        expectedNonce:nonce,idTokenExpected:true,maxAge:provider.maxAuthenticationAgeSeconds });
      const claims=tokens.claims();
      if (!claims || typeof claims.sub!=='string' || !claims.sub || claims.sub.length>255 || !Number.isFinite(claims.auth_time)) throw new Error('Invalid identity claims');
      const mfa=(provider.mfaAcrValues.includes(claims.acr) || (Array.isArray(claims.amr) && provider.mfaAmrValues.some(v => claims.amr.includes(v))));
      return { issuer:claims.iss,subject:claims.sub,mfaVerified:mfa,authenticatedAt:new Date(claims.auth_time*1000) };
    },
  };
}
module.exports={ createOidcClient };
