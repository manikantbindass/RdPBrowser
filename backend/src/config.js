'use strict';

const Joi = require('joi');
const fs = require('fs');
const path = require('path');
const { normalizeAddress } = require('./services/network-source');

const definitions = {
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  HOST: Joi.string().hostname().default('127.0.0.1'),
  PORT: Joi.number().integer().min(1).max(65535).default(3001),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  DB_SSL_MODE: Joi.string().valid('disable', 'verify-full').default('disable'),
  DB_SSL_CA_FILE: Joi.string().allow('').default(''),
  DB_NETWORK_TRUSTED: Joi.boolean().default(false),
  DB_POOL_MAX: Joi.number().integer().min(1).max(50).default(20),
  DEPLOYMENT_ENV: Joi.string().valid('development','staging','production').default('development'),
  SHUTDOWN_GRACE_MS: Joi.number().integer().min(2000).max(25000).default(20000),
  METRICS_ENABLED: Joi.boolean().default(false),
  METRICS_PORT: Joi.number().integer().min(1).max(65535).default(9090),
  METRICS_TOKEN: Joi.string().pattern(/^[A-Za-z0-9_-]{32,256}$/).allow('').default(''),
  OPERATIONS_STATUS_DIRECTORY: Joi.string().allow('').default(''),
  TRACE_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),
  APP_REVISION: Joi.string().pattern(/^[A-Za-z0-9._-]{1,80}$/).default('development'),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().pattern(/^[1-9]\d*[smhd]$/).default('8h'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().pattern(/^[1-9]\d*[smhd]$/).default('7d'),
  VPN_REQUIRED: Joi.boolean().default(true),
  VPN_SUBNET: Joi.string().ip({ cidr: 'required' }).default('10.8.0.0/24'),
  VPN_SUBNETS: Joi.string().max(2048).allow('').default(''),
  VPN_SOURCE_MODE: Joi.string().valid('tunnel', 'egress').default('tunnel'),
  VPN_EGRESS_IPS: Joi.string().max(2048).allow('').default(''),
  VPN_PEER_STATUS_FILE: Joi.string().max(4096).allow('').default(''),
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
  SCIM_ENABLED: Joi.boolean().default(false),
  SCIM_PUBLIC_BASE_URL: Joi.string().uri({ scheme:['https'] }).allow('').default(''),
  SCIM_RATE_LIMIT_MAX: Joi.number().integer().min(10).max(5000).default(200),
  DETECTION_INTERVAL_MS: Joi.number().integer().min(1000).max(300000).default(30000),
  DETECTION_SIGNAL_RETENTION_DAYS: Joi.number().integer().min(1).max(30).default(7),
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
  env = require('./services/secret-files').secretEnvironment(env,['DATABASE_URL','JWT_SECRET','JWT_REFRESH_SECRET','OIDC_STATE_KEY','METRICS_TOKEN']);
  const { value, error } = Joi.object(definitions).unknown(true).validate(env, { abortEarly: false });
  if (error) throw new Error(`Invalid configuration keys: ${[...new Set(error.details.map(d => d.path[0]))].join(', ')}`);
  const config = Object.fromEntries(Object.keys(definitions).map(key => [key, value[key]]));
  const invalid = [];
  if (config.METRICS_ENABLED && (config.METRICS_TOKEN.length<32 || /CHANGE_ME|placeholder/i.test(config.METRICS_TOKEN))) invalid.push('METRICS_TOKEN');
  if (config.METRICS_ENABLED && config.METRICS_PORT===config.PORT) invalid.push('METRICS_PORT');
  if (config.OPERATIONS_STATUS_DIRECTORY && !path.isAbsolute(config.OPERATIONS_STATUS_DIRECTORY)) invalid.push('OPERATIONS_STATUS_DIRECTORY');
  if (config.SCIM_PUBLIC_BASE_URL) {
    const base=new URL(config.SCIM_PUBLIC_BASE_URL);
    if (base.username || base.password || base.hash || base.search || base.pathname!=='/scim/v2') invalid.push('SCIM_PUBLIC_BASE_URL');
  }
  if (config.NODE_ENV==='production' && config.SCIM_ENABLED && !config.SCIM_PUBLIC_BASE_URL) invalid.push('SCIM_PUBLIC_BASE_URL');
  if (config.VPN_PEER_STATUS_FILE && !path.isAbsolute(config.VPN_PEER_STATUS_FILE)) invalid.push('VPN_PEER_STATUS_FILE');
  const vpnSubnets = (config.VPN_SUBNETS || config.VPN_SUBNET).split(',').map(value => value.trim());
  const vpnEgressIps = config.VPN_EGRESS_IPS ? config.VPN_EGRESS_IPS.split(',').map(value => normalizeAddress(value.trim())) : [];
  if (vpnSubnets.length > 32 || vpnSubnets.some(value => {
    const [address, prefix] = value.split('/');
    return Joi.string().ip({ cidr: 'required' }).validate(value).error || !normalizeAddress(address) || Number(prefix) === 0;
  })) invalid.push('VPN_SUBNETS');
  if (vpnEgressIps.length > 32 || vpnEgressIps.includes(null) || (config.VPN_SOURCE_MODE === 'egress' && !vpnEgressIps.length)) invalid.push('VPN_EGRESS_IPS');
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
  const proxies = config.TRUST_PROXY_CIDRS.split(',').map(value => value.trim()).filter(Boolean);
  if (Joi.array().max(32).items(Joi.string().ip({ cidr: 'optional' })).validate(proxies).error ||
      proxies.some(value => value.includes('%') || value.split('/')[1] === '0')) invalid.push('TRUST_PROXY_CIDRS');
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
  return Object.freeze({ ...config,oidcProviders:Object.freeze(oidcProviders), origins: Object.freeze(origins), trustedProxies: Object.freeze(proxies), vpnSubnets: Object.freeze(vpnSubnets), vpnEgressIps: Object.freeze(vpnEgressIps) });
}

function loadEnvironment() {
  // Resolve consistently from repository and backend working directories.
  require('dotenv').config({ path: process.env.ENV_FILE || path.resolve(__dirname, '../.env') });
}

module.exports = { loadConfig, loadEnvironment };
