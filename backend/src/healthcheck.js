'use strict';
const http = require('http');
const req = http.get({ host: '127.0.0.1', port: process.env.PORT || 3000, path: '/ready', timeout: 3000 }, res => {
  res.resume(); process.exitCode = res.statusCode === 200 ? 0 : 1;
});
req.on('timeout', () => req.destroy());
req.on('error', () => { process.exitCode = 1; });
