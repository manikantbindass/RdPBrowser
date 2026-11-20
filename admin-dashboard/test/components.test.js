import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ApiError, createApi } from '../api.js';
import { chartScale, count, moment } from '../components.js';

test('security chart scales measured totals and represents zero data', () => {
  assert.deepEqual(chartScale([]), { step: 1, maximum: 4 });
  assert.deepEqual(chartScale([{ denials: 3, reports: 37 }]), { step: 10, maximum: 40 });
  assert.equal(count(0), '0');
  assert.equal(count(null), '—');
  assert.equal(moment('invalid'), '—');
});

test('concurrent expired requests consume a rotating refresh token once', async () => {
  const requests = [];
  const api = createApi(async (path, options) => {
    requests.push([path, options]);
    const response = (value, status = 200) => Response.json(value, { status });
    if (path.endsWith('/login')) return response({ accessToken: 'old', refreshToken: 'one', user: { role: 'admin' } });
    if (path.endsWith('/refresh')) {
      assert.equal(options.headers.Authorization, undefined);
      assert.deepEqual(JSON.parse(options.body), { refreshToken: 'one' });
      await new Promise(resolve => setImmediate(resolve));
      return response({ accessToken: 'new', refreshToken: 'two' });
    }
    if (options.headers.Authorization === 'Bearer old') return response({ code: 'TOKEN_EXPIRED' }, 401);
    return response({ result: 'ok' });
  });
  await api.login({ username: 'operator' });
  const results = await Promise.all([api.request('/admin/account'), api.request('/admin/stats')]);
  assert.deepEqual(results, [{ result: 'ok' }, { result: 'ok' }]);
  assert.equal(requests.filter(([path]) => path.endsWith('/refresh')).length, 1);
});

test('permission and conflict responses preserve the request ID and never rotate', async () => {
  const paths = [];
  const api = createApi(async path => {
    paths.push(path);
    if (path.endsWith('/login')) return Response.json({ accessToken: 'token', refreshToken: 'next', user: {} });
    return Response.json({ error: 'Access denied', requestId: 'reference' }, { status: 403 });
  });
  await api.login({});
  await assert.rejects(api.request('/admin/account'), error => error instanceof ApiError && error.status === 403 && error.requestId === 'reference');
  assert.deepEqual(paths, ['/api/v1/auth/login', '/api/v1/admin/account']);
});
