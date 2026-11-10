'use strict';
const request = require('supertest');
const { loadConfig } = require('../config');
const { createApp } = require('../http/app');
const { validator } = require('../contracts');
const { redact } = require('../logging');
const { validateApplied, readMigrations } = require('../db/migrations');

const env = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://local:local@127.0.0.1/test',
  JWT_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64), VPN_REQUIRED: 'false' };
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
function app(overrides = {}, database = { checkReady: jest.fn().mockResolvedValue() }) {
  return createApp({ config: loadConfig({ ...env, ...overrides }), logger, database });
}
describe('Validated configuration', () => {
  test.each([
    { PORT: 'not-a-number' }, { PORT: '0' }, { VPN_REQUIRED: 'maybe' }, { VPN_SUBNET: 'invalid' },
    { JWT_SECRET: 'CHANGE_ME_' + 'x'.repeat(40) }, { JWT_REFRESH_SECRET: 'a'.repeat(64) },
    { CORS_ORIGINS: 'http://localhost:5173/admin' }, { TRUST_PROXY_CIDRS: 'true' },
    { DB_SSL_MODE: 'insecure' }, { JWT_EXPIRES_IN: 'forever' }, { JWT_EXPIRES_IN: '0s' },
    { DATABASE_URL: 'postgresql://user:password@localhost/test?sslmode=no-verify' },
  ])('rejects invalid configuration without values: %p', override => {
    expect(() => loadConfig({ ...env, ...override })).toThrow('Invalid configuration keys:');
  });
  it('rejects production bypass and untrusted plaintext DB', () => {
    expect(() => loadConfig({ ...env, NODE_ENV: 'production', CORS_ORIGINS: 'https://admin.test' })).toThrow('VPN_REQUIRED');
    expect(() => loadConfig({ ...env, NODE_ENV: 'production', VPN_REQUIRED: 'true', CORS_ORIGINS: 'https://admin.test' })).toThrow('DB_SSL_MODE');
  });
  it('accepts explicit private DB trust and fails production experimental SSH', () => {
    const prod = { ...env, NODE_ENV: 'production', VPN_REQUIRED: 'true', CORS_ORIGINS: 'https://admin.test', DB_NETWORK_TRUSTED: 'true' };
    expect(loadConfig(prod).VPN_REQUIRED).toBe(true);
    expect(() => loadConfig({ ...prod, SSH_ENABLED: 'true' })).toThrow('SSH_ENABLED');
  });
  it('never returns unknown environment secrets', () => expect(loadConfig({ ...env, UNRELATED_TOKEN: 'private' })).not.toHaveProperty('UNRELATED_TOKEN'));
  it('preserves the exact Windows Tauri UI origin while rejecting remote HTTP origins', () => {
    const prod = { ...env, NODE_ENV: 'production', VPN_REQUIRED: 'true', DB_NETWORK_TRUSTED: 'true' };
    expect(loadConfig({ ...prod, CORS_ORIGINS: 'http://tauri.localhost' }).origins).toEqual(['http://tauri.localhost']);
    expect(() => loadConfig({ ...prod, CORS_ORIGINS: 'http://tauri.localhost.attacker.test' })).toThrow('CORS_ORIGINS');
    expect(() => loadConfig({ ...prod, CORS_ORIGINS: 'http://admin.test' })).toThrow('CORS_ORIGINS');
  });
});
describe('Versioned control plane and compatibility', () => {
  it.each(['/api/auth/login', '/api/v1/auth/login'])('%s uses a shared error contract', async path => {
    const res = await request(app()).post(path).send({});
    expect(res.status).toBe(400);
    expect(validator('http', 'apiError')(res.body)).toBe(true);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });
  it('retains legacy error strings with additive fields', async () => {
    const res = await request(app()).get('/api/admin/stats');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authorization header missing or malformed');
    expect(validator('http', 'apiError')(res.body)).toBe(true);
  });
  it('metadata explicitly distinguishes traffic enforcement', async () => {
    const res = await request(app()).get('/api/v1/meta');
    expect(res.status).toBe(200); expect(validator('http', 'metadata')(res.body)).toBe(true);
  });
  it('reserves unsupported API major versions explicitly', async () => {
    const res = await request(app()).get('/api/v2/admin/stats');
    expect(res.status).toBe(404); expect(res.body.code).toBe('API_VERSION_UNSUPPORTED');
  });
  it('returns not-ready while keeping liveness independent', async () => {
    const api = app({}, { checkReady: jest.fn().mockRejectedValue(new Error('private DB details')) });
    expect((await request(api).get('/health')).status).toBe(200);
    const res = await request(api).get('/ready');
    expect(res.status).toBe(503); expect(res.body.code).toBe('NOT_READY');
    expect(JSON.stringify(res.body)).not.toContain('private');
  });
  it('rejects lookalike origins and accepts an exact configured origin', async () => {
    const api = app({ CORS_ORIGINS: 'http://localhost:5173' });
    expect((await request(api).get('/health').set('Origin', 'http://localhost:5173.attacker.test')).status).toBe(403);
    expect((await request(api).get('/health').set('Origin', 'http://localhost:5173')).status).toBe(200);
  });
  it('does not accept caller-supplied forwarding without a trusted proxy', async () => {
    const res = await request(app({ VPN_REQUIRED: 'true' })).post('/api/v1/auth/login').set('X-Forwarded-For', '10.8.0.2').send({});
    expect(res.status).toBe(403); expect(res.body.code).toBe('VPN_REQUIRED');
  });
  it('supports an explicitly trusted forwarding hop', async () => {
    const res = await request(app({ VPN_REQUIRED: 'true', TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128' })).post('/api/v1/auth/login').set('X-Forwarded-For', '10.8.0.2').send({});
    expect(res.status).toBe(400); expect(res.body.code).toBe('VALIDATION_ERROR');
  });
  it('normalizes malformed JSON without disclosing its body', async () => {
    const res = await request(app()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"password":"private"');
    expect(res.status).toBe(400); expect(validator('http', 'apiError')(res.body)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('private');
  });
});
describe('Domain and migration contracts', () => {
  it('defines each domain entity and rejects invalid revisions/platforms', () => {
    for (const name of ['organization', 'user', 'device', 'session', 'policy', 'event']) expect(validator('domain', name)).toEqual(expect.any(Function));
    expect(validator('domain', 'organization')({ id: 'not-uuid', name: 'Org', status: 'active', revision: 0 })).toBe(false);
  });
  it('rejects changed, unknown or out-of-order migration history', () => {
    const migrations = [{ version: '001_a.sql', checksum: 'a' }, { version: '002_b.sql', checksum: 'b' }];
    expect(() => validateApplied([{ version: '001_a.sql', checksum: 'tampered' }], migrations)).toThrow();
    expect(() => validateApplied([{ version: '003_c.sql', checksum: 'c' }], migrations)).toThrow();
    expect(() => validateApplied([{ version: '002_b.sql', checksum: 'b' }], migrations)).toThrow();
    expect(() => validateApplied([{ version: '001_a.sql', checksum: 'a' }], migrations)).not.toThrow();
    expect(readMigrations()[0].version).toBe('001_initial.sql');
  });
  it('redacts nested credentials and keeps operational fields', () => {
    expect(redact({ event: 'test', nested: { password: 'private', accessToken: 'private', status: 200 } }))
      .toEqual({ event: 'test', nested: { password: '[REDACTED]', accessToken: '[REDACTED]', status: 200 } });
  });
});
