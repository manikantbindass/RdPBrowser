'use strict';

const request = require('supertest');

// Mock ip-range-check so VPN middleware works without real IPs
jest.mock('ip-range-check', () => jest.fn().mockReturnValue(true));

// Mock the DB so tests don't need a real PostgreSQL connection
jest.mock('../db/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  getClient: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  }),
  initDB: jest.fn().mockResolvedValue(undefined),
  pool: { on: jest.fn(), end: jest.fn() },
}));

// Set required env vars before requiring the app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_at_least_32_chars_long';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32_chars_min';
process.env.VPN_SUBNET = '10.8.0.0/24';
process.env.SERVER_PUBLIC_IP = '127.0.0.1';
process.env.PORT = '3001';
process.env.ANOMALY_DETECTION_ENABLED = 'false';

let app;
beforeAll(() => {
  ({ app } = require('../index'));
});

afterAll((done) => {
  done();
});

describe('Health Check', () => {
  it('GET /health returns 200 with ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('RemoteShield X Backend');
  });
});

describe('VPN Enforcement', () => {
  it('VPN check is bypassed in test mode — login endpoint is reachable', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test', password: 'password' });
    // In test mode VPN is bypassed. Expect 400 (validation) not 403 (VPN block)
    expect(res.status).not.toBe(403);
  });
});

describe('404 Handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Route not found');
  });
});

describe('Auth Validation', () => {
  it('POST /api/auth/login returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/login returns 400 for invalid username format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'a', password: 'password123' }); // too short
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/register returns 400 for weak password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'testuser', email: 'test@test.com', password: 'weak' });
    expect(res.status).toBe(400);
  });
});

describe('Admin Routes - Auth Required', () => {
  it('GET /api/admin/stats returns 401 without token', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/admin/sessions returns 401 without token', async () => {
    const res = await request(app).get('/api/admin/sessions');
    expect([401, 403]).toContain(res.status);
  });
});

describe('Proxy Routes - Auth Required', () => {
  it('POST /api/proxy/navigate returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/proxy/navigate')
      .send({ url: 'https://example.com' });
    expect([401, 403]).toContain(res.status);
  });
});
