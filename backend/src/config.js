'use strict';

const Joi = require('joi');
const fs = require('fs');
const path = require('path');

const definitions = {
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  HOST: Joi.string().hostname().default('127.0.0.1'),
  PORT: Joi.number().integer().min(1).max(65535).default(3001),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  DB_SSL_MODE: Joi.string().valid('disable', 'verify-full').default('disable'),
  DB_SSL_CA_FILE: Joi.string().allow('').default(''),
  DB_NETWORK_TRUSTED: Joi.boolean().default(false),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().pattern(/^[1-9]\d*[smhd]$/).default('8h'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().pattern(/^[1-9]\d*[smhd]$/).default('7d'),
  VPN_REQUIRED: Joi.boolean().default(true),
  VPN_SUBNET: Joi.string().ip({ cidr: 'required' }).default('10.8.0.0/24'),
  SERVER_PUBLIC_IP: Joi.string().ip().default('127.0.0.1'),
  SERVER_VPN_IP: Joi.string().ip().default('10.8.0.1'),
  TRUST_PROXY_CIDRS: Joi.string().allow('').default(''),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  DASHBOARD_ORIGIN: Joi.string().allow('').default(''), // legacy alias
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).max(86400000).default(900000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).max(100000).default(100),
  MAX_SESSIONS_PER_USER: Joi.number().integer().min(1).max(100).default(1),
  DEVICE_BINDING_ENABLED: Joi.boolean().default(true),
  ANOMALY_DETECTION_ENABLED: Joi.boolean().default(false),
  ANOMALY_ORGANIZATION_IDS: Joi.string().default('00000000-0000-4000-8000-000000000001'),
  SSH_ENABLED: Joi.boolean().default(false),
  GEO_RESTRICTION_ENABLED: Joi.boolean().default(false),
  ALLOWED_COUNTRIES: Joi.string().pattern(/^[A-Z]{2}(,[A-Z]{2})*$/).default('IN,US,GB'),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  REGISTRATION_ENABLED: Joi.boolean().default(false),
  AUTH_RATE_LIMIT_MAX: Joi.number().integer().min(1).max(1000).default(20),
  OIDC_PROVIDERS_FILE:Joi.string().allow('').default(''),
  OIDC_STATE_KEY:Joi.string().allow('').default(''),
};

function loadConfig(env = process.env) {
  const { value, error } = Joi.object(definitions).unknown(true).validate(env, { abortEarly: false });
  if (error) throw new Error(`Invalid configuration keys: ${[...new Set(error.details.map(d => d.path[0]))].join(', ')}`);
  const config = Object.fromEntries(Object.keys(definitions).map(key => [key, value[key]]));
  const invalid = [];
  if (Joi.array().max(100).items(Joi.string().guid()).validate(config.ANOMALY_ORGANIZATION_IDS.split(',')).error) invalid.push('ANOMALY_ORGANIZATION_IDS');
  if (['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].some(key => new URL(config.DATABASE_URL).searchParams.has(key))) invalid.push('DATABASE_URL (set TLS using DB_SSL_MODE/DB_SSL_CA_FILE)');
  if (config.JWT_SECRET === config.JWT_REFRESH_SECRET) invalid.push('JWT_REFRESH_SECRET');
  if ([config.JWT_SECRET, config.JWT_REFRESH_SECRET].some(v => /CHANGE_ME|YOUR_|example|placeholder/i.test(v))) invalid.push('JWT_SECRET/JWT_REFRESH_SECRET');
  const origins = (config.CORS_ORIGINS || config.DASHBOARD_ORIGIN || (config.NODE_ENV === 'production' ? '' : 'http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:8180,tauri://localhost,http://tauri.localhost,https://tauri.localhost')).split(',').filter(Boolean);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (origin !== 'tauri://localhost' && (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)) invalid.push('CORS_ORIGINS');
      // Tauri 2's Windows custom-protocol origin is HTTP by default. This
      // exact UI origin does not make the remote control-plane endpoint HTTP.
      if (config.NODE_ENV === 'production' && url.protocol === 'http:' && origin !== 'http://tauri.localhost') invalid.push('CORS_ORIGINS');
    } catch { invalid.push('CORS_ORIGINS'); }
  }
  const proxies = config.TRUST_PROXY_CIDRS.split(',').filter(Boolean);
  if (Joi.array().items(Joi.string().ip({ cidr: 'optional' })).validate(proxies).error) invalid.push('TRUST_PROXY_CIDRS');
  if (config.NODE_ENV === 'production') {
    if (!config.VPN_REQUIRED) invalid.push('VPN_REQUIRED');
    if (config.DB_SSL_MODE === 'disable' && !config.DB_NETWORK_TRUSTED) invalid.push('DB_SSL_MODE/DB_NETWORK_TRUSTED');
    if (config.SSH_ENABLED) invalid.push('SSH_ENABLED (experimental transport is development-only)');
    if (!origins.length) invalid.push('CORS_ORIGINS');
  }
  if (config.DB_SSL_CA_FILE && !fs.existsSync(config.DB_SSL_CA_FILE)) invalid.push('DB_SSL_CA_FILE');
  if (invalid.length) throw new Error(`Invalid configuration keys: ${[...new Set(invalid)].join(', ')}`);
  const oidcProviders=require('./services/oidc-config').loadProviders(config.OIDC_PROVIDERS_FILE,env);
  if (oidcProviders.length && (!/^[0-9a-f]{64}$/i.test(config.OIDC_STATE_KEY) || config.OIDC_STATE_KEY===config.JWT_SECRET || config.OIDC_STATE_KEY===config.JWT_REFRESH_SECRET)) throw new Error('Invalid configuration keys: OIDC_STATE_KEY');
  if (env.REGISTRATION_ENABLED === undefined && config.NODE_ENV !== 'production') config.REGISTRATION_ENABLED = true;
  return Object.freeze({ ...config,oidcProviders:Object.freeze(oidcProviders), origins: Object.freeze(origins), trustedProxies: Object.freeze(proxies) });
}

function loadEnvironment() {
  // Resolve consistently from repository and backend working directories.
  require('dotenv').config({ path: process.env.ENV_FILE || path.resolve(__dirname, '../.env') });
}

module.exports = { loadConfig, loadEnvironment };
