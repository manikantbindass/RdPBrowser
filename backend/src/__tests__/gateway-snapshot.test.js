'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
jest.mock('../db/db', () => ({ query: jest.fn() }));
const { query } = require('../db/db');
const { gatewayHealth } = require('../services/gateway-snapshot');
const own = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
let directory, file;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsx-peers-'));
  file = path.join(directory, 'status.json');
  query.mockReset();
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

async function writeSnapshot(text, mtime) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed fixture name in this test's private temporary directory.
  const handle = await fs.open(file, 'w');
  try {
    await handle.writeFile(text);
    if (mtime) await handle.utimes(mtime, mtime);
  } finally { await handle.close(); }
}

test('gateway counters include only device IDs visible through the tenant query', async () => {
  const peer = deviceId => ({ deviceId, active: true, configured: true, handshakeAgeSeconds: 10 });
  await writeSnapshot(JSON.stringify({ peers: [peer(own), peer(other)] }));
  query.mockResolvedValue({ rows: [{ id: own }] });
  const result = await gatewayHealth(file);
  expect(result).toMatchObject({ state: 'available', enrolled: 1, active: 1, configured: 1, recent: 1 });
  expect(query.mock.calls[0][1]).toEqual([[own, other]]);
  expect(JSON.stringify(result)).not.toContain(other);
});

test('absent, invalid and stale gateway observations remain explicit', async () => {
  expect(await gatewayHealth('')).toEqual({ state: 'not_configured' });
  expect(await gatewayHealth(file)).toEqual({ state: 'unavailable' });
  await writeSnapshot('{"peers":[{"deviceId":"invalid"}]}');
  expect(await gatewayHealth(file)).toEqual({ state: 'unavailable' });
  const stale = new Date(Date.now() - 180000);
  await writeSnapshot('{"peers":[]}', stale);
  expect(await gatewayHealth(file)).toEqual({ state: 'stale' });
  expect(query).not.toHaveBeenCalled();
});
