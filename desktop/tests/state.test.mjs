import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import {
  normalizedAddress,
  storedUrl,
  parsePreferences,
  serializePreferences,
} from '../src/browserState.ts';
import { signatureDer } from '../src/deviceProof.ts';
test('address validation rejects active schemes, credentials and control characters', () => {
  for (const raw of [
    'javascript:alert(1)',
    'file:///private',
    'data:text/html,x',
    'https://user:pass@example.com',
    'https://example.com\npath',
    'x'.repeat(8193),
  ])
    assert.throws(() => normalizedAddress(raw));
  assert.equal(normalizedAddress('example.com'), 'https://example.com/');
  assert.equal(
    new URL(normalizedAddress('company benefits')).searchParams.get('q'),
    'company benefits',
  );
});
test('saved state is bounded, versioned and omits query credentials and fragments', () => {
  assert.equal(
    storedUrl('https://example.com/path?token=secret#fragment'),
    'https://example.com/path',
  );
  assert.equal(storedUrl('https://user:pass@example.com'), '');
  assert.equal(parsePreferences('{bad').tabs.length, 0);
  assert.equal(parsePreferences(JSON.stringify({ version: 9 })).tabs.length, 0);
  const saved = parsePreferences(
    JSON.stringify({
      version: 1,
      theme: 'script',
      tabs: Array(100).fill({ url: 'https://example.com/?secret=private' }),
      history: ['javascript:bad', 'https://example.com/?private'],
      bookmarks: ['file:///etc/passwd'],
    }),
  );
  assert.equal(saved.tabs.length, 20);
  assert.equal(saved.theme, 'dark');
  assert.deepEqual(saved.bookmarks, []);
  assert.ok(!serializePreferences(saved).includes('secret'));
  assert.ok(!serializePreferences(saved).includes('private'));
});
test('P1363 conversion produces server-verifiable P-256 DER signatures', () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  for (let i = 0; i < 25; i++) {
    const data = Buffer.from(`session-bound-challenge-${i}`);
    const raw = sign('sha256', data, {
      key: keys.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    const der = signatureDer(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    );
    assert.equal(verify('sha256', data, keys.publicKey, der), true);
    assert.equal(
      verify('sha256', Buffer.from('wrong-challenge'), keys.publicKey, der),
      false,
    );
  }
  assert.throws(() => signatureDer(new ArrayBuffer(63)));
});
