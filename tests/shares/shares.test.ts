import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShare, parseShares } from '../../src/shares/shares';

test('rejects empty shares and trims saved text', () => {
  assert.throws(() => createShare(' \n '));
  const share = createShare('  My thoughts\nare here.  ');
  assert.equal(share.text, 'My thoughts\nare here.');
  assert.notEqual(share.id, createShare('Another thought').id);
  assert.ok(Number.isFinite(Date.parse(share.createdAt)));
});
test('round trips stored shares and orders newest first', () => {
  const first = {
    ...createShare('Earlier'),
    createdAt: '2025-04-22T12:00:00Z'
  };
  const second = { ...createShare('Later'), createdAt: '2025-04-23T12:00:00Z' };
  assert.deepEqual(parseShares(JSON.stringify([first, second])), [
    second,
    first
  ]);
  assert.deepEqual(parseShares(null), []);
});
test('rejects malformed storage instead of silently discarding history', () => {
  for (const raw of [
    '{',
    '{}',
    '[null]',
    '[{"text":"hello"}]',
    JSON.stringify([{ ...createShare('Valid'), createdAt: 'invalid' }])
  ]) {
    assert.throws(() => parseShares(raw));
  }
});
