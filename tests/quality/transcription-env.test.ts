import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'dotenv';

test('Amplify transcription preparation validates configuration and copies only non-secret settings idempotently', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'doorknob-env-test-'));
  const script = path.resolve('scripts/prepare-transcription-env.mjs');
  const file = path.join(directory, '.env.production');
  const run = (settings: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        AWS_SECRET_ACCESS_KEY: 'fictional-must-not-be-written',
        STT_OPENAI_API_KEY: 'fictional-must-not-be-written',
        STT_SONIOX_API_KEY: 'fictional-must-not-be-written',
        STT_SONIOX_SECRET_ARN:
          'arn:aws:secretsmanager:us-west-2:123456789012:secret:synthetic',
        STT_PROVIDER: 'soniox',
        STT_ENABLED: 'true',
        ...settings
      }
    });
  try {
    writeFileSync(
      file,
      [
        'export EXISTING_SETTING="keep # a literal hash"',
        'QUOTED_SETTING="a value with spaces"',
        'MULTILINE_SETTING="first\nsecond"',
        'STT_PROVIDER=openai',
        ''
      ].join('\n')
    );
    assert.equal(run().status, 0);
    const generated = readFileSync(file, 'utf8');
    const parsed = parse(generated);
    assert.equal(parsed.EXISTING_SETTING, 'keep # a literal hash');
    assert.equal(parsed.QUOTED_SETTING, 'a value with spaces');
    assert.equal(parsed.MULTILINE_SETTING, 'first\nsecond');
    assert.match(generated, /STT_PROVIDER=soniox/);
    assert.match(generated, /STT_SONIOX_SECRET_ARN=arn:aws:secretsmanager/);
    assert.equal(
      run({ STT_SONIOX_SECRET_ARN: 'bad\nINJECTED=true' }).status,
      1
    );
    assert.equal(generated.includes('fictional-must-not-be-written'), false);
    assert.equal(run({ STT_PROVIDER: 'soniox\nINJECTED=true' }).status, 1);
    assert.equal(run().status, 0);
    assert.equal(readFileSync(file, 'utf8'), generated);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
