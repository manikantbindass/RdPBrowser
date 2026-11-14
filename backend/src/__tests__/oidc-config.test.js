'use strict';
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const { loadConfig }=require('../config');
const base={ NODE_ENV:'test',DATABASE_URL:'postgresql://test:local@localhost/test',JWT_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),VPN_REQUIRED:'false' };
const provider={ id:'enterprise',organizationId:'00000000-0000-4000-8000-000000000001',issuer:'https://idp.example.com',clientId:'test-client',
  clientSecretEnv:'TEST_ONLY_CLIENT_SECRET',redirectUri:'https://app.example.com/api/v1/auth/oidc/enterprise/callback',mfaAcrValues:['urn:test:mfa'] };
let directory,file;
beforeEach(() => { directory=fs.mkdtempSync(path.join(os.tmpdir(),'rsx-oidc-'));file=path.join(directory,'providers.json'); });
afterEach(() => { if(fs.existsSync(file)) fs.unlinkSync(file);fs.rmdirSync(directory); });
function config(change={},env={}) {
  fs.writeFileSync(file,JSON.stringify([{ ...provider,...change }]));
  return loadConfig({ ...base,OIDC_PROVIDERS_FILE:file,OIDC_STATE_KEY:crypto.randomBytes(32).toString('hex'),TEST_ONLY_CLIENT_SECRET:crypto.randomBytes(24).toString('hex'),...env });
}
test('OIDC is disabled until valid operator configuration and independent sealing key exist',() => {
  expect(loadConfig(base).oidcProviders).toEqual([]);
  const configured=config();expect(configured.oidcProviders[0].organizationId).toBe(provider.organizationId);
  expect(() => config({}, { OIDC_STATE_KEY:'' })).toThrow('OIDC_STATE_KEY');
  expect(() => config({}, { OIDC_STATE_KEY:base.JWT_SECRET })).toThrow('OIDC_STATE_KEY');
});
test.each([{ issuer:'http://idp.example.com' },{ issuer:'https://user:password@idp.example.com' },
  { redirectUri:'https://evil.example.com/callback' },{ redirectUri:'https://app.example.com/api/v1/auth/oidc/enterprise/callback?next=evil' },
  { clientSecret:'hardcoded-is-not-accepted' },{ organizationId:'untrusted' }])('rejects unsafe provider configuration %p',change => {
  expect(() => config(change)).toThrow('Invalid OIDC');
});
test('missing client secret is reported without disclosing values',() => {
  expect(() => config({}, { TEST_ONLY_CLIENT_SECRET:'' })).toThrow('missing secret environment');
});
