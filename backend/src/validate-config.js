'use strict';
const { loadConfig, loadEnvironment } = require('./config');
try { loadEnvironment(); const config = loadConfig(); console.log(JSON.stringify({ valid: true, environment: config.NODE_ENV })); }
catch (err) { console.error(err.message); process.exitCode = 1; }
