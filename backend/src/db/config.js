'use strict';
const fs = require('node:fs');
const { Joi,validate } = require('../services/validation');
const { secretEnvironment } = require('../services/secret-files');
function loadDatabaseConfig(environment = process.env) {
  const env = secretEnvironment(environment, ['DATABASE_URL','MIGRATION_DATABASE_URL','DB_RUNTIME_PASSWORD']);
  if (env.DB_NETWORK_TRUSTED !== undefined && ![true,false,'true','false'].includes(env.DB_NETWORK_TRUSTED)) throw new Error('Invalid database network trust');
  const value = validate(Joi.object({
    DATABASE_URL:Joi.string().uri({ scheme:['postgres','postgresql'] }).required(),
    DB_SSL_MODE:Joi.string().valid('disable','verify-full').default('disable'),
    DB_SSL_CA_FILE:Joi.string().allow('').default(''),
    DB_NETWORK_TRUSTED:Joi.boolean().default(false),
    DB_POOL_MAX:Joi.number().integer().min(1).max(50).default(20),
    DB_RUNTIME_PASSWORD:Joi.string().min(32).allow('').default(''),
    NODE_ENV:Joi.string().valid('development','test','production').default('development'),
    LOG_LEVEL:Joi.string().valid('error','warn','info','debug').default('info'),
  }), { DATABASE_URL:env.MIGRATION_DATABASE_URL || env.DATABASE_URL,DB_SSL_MODE:env.DB_SSL_MODE,
    DB_SSL_CA_FILE:env.DB_SSL_CA_FILE,DB_NETWORK_TRUSTED:env.DB_NETWORK_TRUSTED === 'true' || env.DB_NETWORK_TRUSTED === true,
    DB_POOL_MAX:env.DB_POOL_MAX === undefined ? 20 : Number(env.DB_POOL_MAX),DB_RUNTIME_PASSWORD:env.DB_RUNTIME_PASSWORD,
    NODE_ENV:env.NODE_ENV,LOG_LEVEL:env.LOG_LEVEL });
  if (value.NODE_ENV==='production' && value.DB_SSL_MODE==='disable' && !value.DB_NETWORK_TRUSTED) throw new Error('Database network trust is required');
  if (value.DB_SSL_CA_FILE && !fs.existsSync(value.DB_SSL_CA_FILE)) throw new Error('Database CA file is unavailable');
  if (['sslmode','sslcert','sslkey','sslrootcert'].some(key => new URL(value.DATABASE_URL).searchParams.has(key))) throw new Error('Use explicit database TLS settings');
  return value;
}
module.exports = { loadDatabaseConfig };
