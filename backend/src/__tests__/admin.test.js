'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../db/db', () => ({ query: jest.fn() }));
const { query } = require('../db/db');
const adminRoutes = require('../routes/admin');

// Router-level regression tests: real authentication and PostgreSQL remain
// separate integration acceptance criteria; this fixture grants an admin role.
const app = express();
app.use((req, res, next) => { req.user = { role: 'admin' }; next(); });
app.use('/api/admin', adminRoutes);

beforeEach(() => query.mockReset());

describe('IP log pagination', () => {
  it('uses a defined alias in both queries when filtering flagged logs', async () => {
    const logs = [{ id: 'log-1', flagged: true }];
    query.mockResolvedValueOnce({ rows: logs }).mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const response = await request(app).get('/api/admin/ip-logs?flagged=true&page=2&limit=10');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ logs, total: 1, page: 2, limit: 10 });
    expect(query.mock.calls[0][0]).toMatch(/FROM ip_logs l[\s\S]*WHERE l\.flagged = TRUE/);
    expect(query.mock.calls[0][1]).toEqual([10, 10]);
    // PostgreSQL rejects l.flagged unless the count query defines alias l.
    expect(query.mock.calls[1][0]).toMatch(/FROM ip_logs l WHERE l\.flagged = TRUE/);
  });

  it('keeps the default unfiltered response and pagination', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const response = await request(app).get('/api/admin/ip-logs');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ logs: [], total: 0, page: 1, limit: 50 });
    expect(query.mock.calls[0][1]).toEqual([50, 0]);
    expect(query.mock.calls[1][0]).not.toContain('WHERE');
  });
});
