'use strict';

const request = require('supertest');
const { createApp } = require('../http/app');
const { loadConfig } = require('../config');
const { createSourceGate } = require('../realtime/sourceGate');

const env = {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:local@localhost/test',
  JWT_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64),
  VPN_REQUIRED: 'true', TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128',
};
const logger = { info() {}, error() {}, warn() {} };
const route = '/api/v1/network/status';
const makeApp = config => createApp({ config, logger, database: {} });

test('IPv6 tunnel source is normalized and hits the same HTTP and socket gates', async () => {
  const config = loadConfig({ ...env, VPN_SUBNETS: '10.8.0.0/24,fd42:5253:5800::/64' });
  const result = await request(makeApp(config)).get(route).set('X-Forwarded-For', 'FD42:5253:5800:0::29');
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.body).toEqual({ sourceGate: 'accepted', observedAddress: 'fd42:5253:5800::29',
    sourceMode: 'tunnel', trafficEnforcement: 'external' });
  const callback = jest.fn();
  createSourceGate(config)({ socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: { 'x-forwarded-for': 'fd42:5253:5800::29' } }, callback);
  expect(callback).toHaveBeenCalledWith(null, true);
});

test('missing, multi-hop or malformed forwarding from a trusted edge is denied', async () => {
  const app = makeApp(loadConfig(env));
  for (const spoof of ['', '10.8.0.2, 192.0.2.25', '10.8.0.2/32', 'fe80::2%eth0']) {
    const result = await request(app).get(route).set('X-Forwarded-For', spoof);
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('VPN_REQUIRED');
  }
});

test('egress mode matches exact observed addresses and ignores untrusted headers', async () => {
  const settings = { ...env, VPN_SOURCE_MODE: 'egress', VPN_EGRESS_IPS: '203.0.113.5,2001:db8::5' };
  const app = makeApp(loadConfig(settings));
  expect((await request(app).get(route).set('X-Forwarded-For', '::ffff:203.0.113.5')).body.sourceGate).toBe('accepted');
  expect((await request(app).get('/api/network/status').set('X-Forwarded-For', '2001:DB8:0::5')).status).toBe(200);
  expect((await request(app).get(route).set('X-Forwarded-For', '203.0.113.6')).status).toBe(403);
  expect((await request(app).get(route).set('X-Forwarded-For', '10.8.0.2')).status).toBe(403);
  const direct = makeApp(loadConfig({ ...settings, TRUST_PROXY_CIDRS: '' }));
  expect((await request(direct).get(route).set('X-Forwarded-For', '203.0.113.5')).status).toBe(403);
});

test('source validation rejects wildcard ranges and missing or non-address egress entries', () => {
  for (const settings of [
    { VPN_SUBNETS: '0.0.0.0/0' }, { VPN_SUBNETS: '::/0' }, { VPN_SUBNETS: '10.8.0.0/24,' },
    { VPN_SOURCE_MODE: 'egress' }, { VPN_EGRESS_IPS: '203.0.113.0/24' }, { VPN_EGRESS_IPS: 'gateway.test' },
    { TRUST_PROXY_CIDRS: '0.0.0.0/0' }, { TRUST_PROXY_CIDRS: '::/0' },
  ]) {
    expect(() => loadConfig({ ...env, ...settings })).toThrow('Invalid configuration keys');
  }
});
