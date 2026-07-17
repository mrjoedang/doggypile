import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePairLink, sessionTimestamp } from './home-shell.js';

test('sessionTimestamp normalizes daemon seconds and browser milliseconds', () => {
  assert.equal(sessionTimestamp({ updatedAt: 1_700_000_000 }), 1_700_000_000_000);
  assert.equal(sessionTimestamp({ updatedAt: 1_700_000_000_123 }), 1_700_000_000_123);
});

test('sessionTimestamp accepts ISO recency fallback and rejects bad values', () => {
  assert.equal(sessionTimestamp({ recencyAt: '2024-01-02T03:04:05.000Z' }), Date.parse('2024-01-02T03:04:05.000Z'));
  assert.equal(sessionTimestamp({ updatedAt: 'not-a-date' }), 0);
  assert.equal(sessionTimestamp({}), 0);
});

test('updatedAt remains authoritative when both timestamp fields exist', () => {
  assert.equal(sessionTimestamp({ updatedAt: 42, recencyAt: 99 }), 42_000);
});

test('parsePairLink accepts complete URLs and raw fragments', () => {
  assert.deepEqual(parsePairLink('https://example.test/#node=n1&token=t1&name=Desk&addr=a&addr=b'), {
    id: 'n1', token: 't1', name: 'Desk', relay: null, addrs: ['a', 'b'],
  });
  assert.equal(parsePairLink('node=n1'), null);
  assert.equal(parsePairLink('  node=n1&token=t1  ').id, 'n1');
});
