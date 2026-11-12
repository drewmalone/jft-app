import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readings } from '../../src/readings/server/configured-readings';
import type { ReadingCache } from '../../src/readings/server/cache';

test('real configured loading reports safe initial failures and retries after a file is corrected', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'reading-diagnostics-'));
  const path = join(directory, 'catalog.yaml');
  const state = globalThis as typeof globalThis & {
    dailyReadings?: ReadingCache;
  };
  const previous = state.dailyReadings;
  const keys = ['READINGS_SOURCE', 'READINGS_LOCAL_PATH'] as const;
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  delete state.dailyReadings;
  process.env.READINGS_SOURCE = 'local';
  process.env.READINGS_LOCAL_PATH = path;
  t.after(async () => {
    state.dailyReadings = previous;
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await rm(directory, { recursive: true, force: true });
  });
  const logs = t.mock.method(console, 'error', () => {});
  const now = Date.parse('2028-12-03T12:00:00Z');
  await assert.rejects(readings.today('America/Chicago', now));
  assert.match(JSON.stringify(logs.mock.calls[0].arguments), /File not found/);
  const row = {
    date: '12-03',
    title: 'Fictional diagnostic title',
    quote: 'Fictional quotation',
    body: 'Fictional body that must not appear in logs.'
  };
  await writeFile(path, JSON.stringify([row]));
  await assert.rejects(readings.today('America/Chicago', now));
  const diagnostic = JSON.stringify(logs.mock.calls[1].arguments);
  assert.match(diagnostic, /0.source/);
  assert.equal(diagnostic.includes(row.body), false);
  assert.equal(diagnostic.includes(row.title), false);
  await writeFile(
    path,
    JSON.stringify([{ ...row, source: 'Fictional collection' }])
  );
  const result = await readings.today('America/Chicago', now);
  assert.equal(result.reading?.body, row.body);
  assert.equal(logs.mock.callCount(), 2);
});
