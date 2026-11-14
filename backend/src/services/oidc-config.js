'use strict';
const fs=require('fs');
const { Joi }=require('./validation');
const schema=Joi.array().max(20).items(Joi.object({
  id:Joi.string().pattern(/^[a-z][a-z0-9-]{0,63}$/).required(),organizationId:Joi.string().guid().required(),
  issuer:Joi.string().uri({ scheme:['https'] }).required(),clientId:Joi.string().min(1).max(255).required(),
  clientSecretEnv:Joi.string().pattern(/^[A-Z][A-Z0-9_]{2,79}$/).required(),
  redirectUri:Joi.string().uri({ scheme:['https'] }).required(),
  mfaAcrValues:Joi.array().items(Joi.string().min(1).max(255)).max(20).default([]),
  mfaAmrValues:Joi.array().items(Joi.string().min(1).max(80)).max(20).default([]),
  maxAuthenticationAgeSeconds:Joi.number().integer().min(60).max(86400).default(3600),
})).unique('id');
function loadProviders(file,env) {
  if (!file) return [];
  try {
    const { error,value }=schema.validate(JSON.parse(fs.readFileSync(file,'utf8')),{ convert:false });
    if (error) throw error;
    return value.map(provider => {
      const issuer=new URL(provider.issuer),redirect=new URL(provider.redirectUri);
      if (issuer.username || issuer.password || issuer.hash || issuer.search || redirect.username || redirect.password || redirect.hash || redirect.search ||
          redirect.pathname!==`/api/v1/auth/oidc/${provider.id}/callback`) throw new Error('Invalid provider URL');
      const secret=env[provider.clientSecretEnv];
      if (!secret || secret.length<16 || /CHANGE_ME|placeholder/i.test(secret)) throw new Error('Provider secret missing');
      return Object.freeze({ ...provider,clientSecret:secret });
    });
  } catch { throw new Error('Invalid OIDC provider configuration or missing secret environment'); }
}
module.exports={ loadProviders };
