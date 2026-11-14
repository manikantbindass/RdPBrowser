'use strict';

const winston = require('winston');
const secretKey = /password|secret|authorization|cookie|token|credential|database_url|private.?key|preshared.?key|state.?key|verifier|nonce|sealed.?context/i;
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, secretKey.test(key) ? '[REDACTED]' : redact(child)]));
  return value;
}
function createLogger(config) {
  const logger = winston.createLogger({
    level: config.LOG_LEVEL,
    format: winston.format.combine(winston.format.timestamp(), winston.format(info => Object.assign(info, redact(info)))(), winston.format.json()),
    transports: [new winston.transports.Console({ silent: config.NODE_ENV === 'test' })],
  });
  return logger;
}
module.exports = { createLogger, redact };
