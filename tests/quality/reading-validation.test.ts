import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('catalog validation CLI accepts bare lists and prints root/field errors as readable text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reading-validation-'));
  const path = join(directory, 'catalog.yaml');
  const row = {
    date: '12-03',
    title: 'Fictional private title',
    quote: 'Fictional private quotation',
    source: 'Fictional collection',
    body: 'Fictional private body'
  };
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '--conditions=react-server',
        '--import',
        resolve('node_modules/tsx/dist/loader.mjs'),
        resolve('scripts/validate-readings.ts'),
        path
      ],
      { encoding: 'utf8' }
    );
  try {
    writeFileSync(path, JSON.stringify({ readings: [row] }));
    const wrapped = run();
    assert.equal(wrapped.status, 1);
    assert.match(wrapped.stderr, /\(root\): expected array/);
    assert.equal(wrapped.stderr.includes(row.body), false);
    assert.equal(wrapped.stderr.includes(row.quote), false);
    writeFileSync(path, JSON.stringify([{ ...row, source: null }]));
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /0.source: expected string/);
    writeFileSync(path, JSON.stringify([row]));
    const valid = run();
    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /Validated 1 annual readings/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
