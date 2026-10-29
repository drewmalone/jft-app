import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createSecretReader } from '../../src/shares/server/secrets-manager';

const binding = { arn: 'fictional-secret', region: 'us-east-1' };

test('secret reader coalesces concurrent requests, expires cached values and destroys clients', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let resolve!: (result: { SecretString: string }) => void;
  const send = t.mock.method(
    SecretsManagerClient.prototype,
    'send',
    () =>
      new Promise<{ SecretString: string }>((done) => {
        resolve = done;
      })
  );
  const destroy = t.mock.method(
    SecretsManagerClient.prototype,
    'destroy',
    () => {}
  );
  const read = createSecretReader((value) => value);
  const first = read(binding);
  const concurrent = read(binding);
  assert.equal(send.mock.callCount(), 1);
  resolve({ SecretString: 'first' });
  assert.deepEqual(await Promise.all([first, concurrent]), ['first', 'first']);
  assert.equal(await read(binding), 'first');
  t.mock.timers.setTime(301_001);
  const refreshed = read(binding);
  assert.equal(send.mock.callCount(), 2);
  resolve({ SecretString: 'rotated' });
  assert.equal(await refreshed, 'rotated');
  assert.equal(destroy.mock.callCount(), 2);
});

test('secret reader retries transport and value validation failures', async (t) => {
  let attempt = 0;
  t.mock.method(SecretsManagerClient.prototype, 'send', async () => {
    if (++attempt === 1) throw new Error('unavailable');
    return { SecretString: attempt === 2 ? 'invalid' : 'valid' };
  });
  const destroy = t.mock.method(
    SecretsManagerClient.prototype,
    'destroy',
    () => {}
  );
  const read = createSecretReader((value) => {
    if (value !== 'valid') throw new Error('invalid value');
    return value;
  });
  await assert.rejects(read(binding), /unavailable/);
  await assert.rejects(read(binding), /invalid value/);
  assert.equal(await read(binding), 'valid');
  assert.equal(attempt, 3);
  assert.equal(destroy.mock.callCount(), 3);
});
