'use strict';

const { open } = require('node:fs/promises');
const { constants } = require('node:fs');
const { isAbsolute } = require('node:path');
const { uuid } = require('../db/tenant');
const { query } = require('../db/db');

const MAX_BYTES = 256 * 1024;
const MAX_AGE = 120;
const RECENT_HANDSHAKE = 180;

async function readSnapshot(file) {
  if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('Invalid snapshot path');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Startup config selects a mounted status file. Inspect the opened descriptor and cap each read.
  const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Invalid snapshot file');
    const age = Math.floor((Date.now() - info.mtimeMs) / 1000);
    if (age < -5 || age > MAX_AGE) return { state: 'stale' };
    const buffer = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size) throw new Error('Snapshot size changed');
    const data = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (!Array.isArray(data?.peers) || data.peers.length > 253) throw new Error('Invalid peer list');
    const peers = new Map();
    for (const peer of data.peers) {
      if (!peer || typeof peer.deviceId !== 'string' || !uuid.test(peer.deviceId) || peers.has(peer.deviceId) ||
          typeof peer.active !== 'boolean' || typeof peer.configured !== 'boolean' ||
          (peer.handshakeAgeSeconds !== null && (!Number.isSafeInteger(peer.handshakeAgeSeconds) || peer.handshakeAgeSeconds < 0))) {
        throw new Error('Invalid peer observation');
      }
      peers.set(peer.deviceId, peer);
    }
    return { state: 'available', age: Math.max(0, age), peers };
  } finally {
    await handle.close();
  }
}

async function gatewayHealth(file) {
  if (!file) return { state: 'not_configured' };
  let snapshot;
  try { snapshot = await readSnapshot(file); } catch { return { state: 'unavailable' }; }
  if (snapshot.state !== 'available') return snapshot;
  const { rows } = await query('SELECT id FROM devices WHERE id=ANY($1::uuid[])', [[...snapshot.peers.keys()]]);
  const peers = rows.map(row => snapshot.peers.get(row.id));
  const active = peers.filter(peer => peer.active);
  return { state: 'available', sampleAgeSeconds: snapshot.age, enrolled: peers.length, active: active.length,
    configured: active.filter(peer => peer.configured).length,
    recent: active.filter(peer => peer.configured && peer.handshakeAgeSeconds !== null &&
      peer.handshakeAgeSeconds + snapshot.age <= RECENT_HANDSHAKE).length };
}

module.exports = { gatewayHealth };
