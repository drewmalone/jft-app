import '@hono/zod-openapi';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { validateRuntimeConfig } from '../../src/config/runtime';
import { validateSigningSecret } from '../../src/config/deployment';
import { securityHeaders } from '../../src/config/security-headers';
import { parseCatalog } from '../../src/readings/server/catalog';
import { ReadingCache } from '../../src/readings/server/cache';
import { createShareService } from '../../src/shares/server/application/create-share';
import { InMemoryShareRepository } from '../../src/shares/server/storage/memory-repository';
import { reflection } from '../fixtures/sample-reading';
import { dispatch } from '../fixtures/application';
import { useReadingFixture } from '../fixtures/reading-service';

test('hosted profiles require durable isolated storage, distributed quotas and runtime signing', () => {
  const hosted = {
    DEPLOYMENT_ENV: 'dev',
    SHARE_PERSISTENCE: 'dynamodb',
    DYNAMODB_TABLE_NAME: 'fictional-shares',
    DYNAMODB_REGION: 'us-west-2',
    QUOTA_TABLE_NAME: 'fictional-quotas'
  };
  assert.doesNotThrow(() => validateRuntimeConfig({}));
  assert.throws(() => validateRuntimeConfig({ AWS_BRANCH: 'main' }));
  assert.doesNotThrow(() => validateRuntimeConfig(hosted));
  for (const override of [
    { SHARE_PERSISTENCE: 'memory' },
    { QUOTA_TABLE_NAME: '' },
    { QUOTA_TABLE_NAME: 'fictional-shares' },
    { QUOTA_LOCAL_ONLY: 'true' }
  ])
    assert.throws(() => validateRuntimeConfig({ ...hosted, ...override }));
  assert.throws(() => validateSigningSecret({}));
  assert.throws(() => validateSigningSecret({ SESSION_SECRET: 'short' }));
  assert.doesNotThrow(() =>
    validateSigningSecret({
      SESSION_SECRET: 'fictional-stable-secret-at-least-32-bytes'
    })
  );
  assert.throws(() =>
    validateRuntimeConfig({ ...hosted, DEPLOYMENT_ENV: 'prod' })
  );
  assert.throws(() =>
    validateRuntimeConfig({
      ...hosted,
      DEPLOYMENT_ENV: 'prod',
      READINGS_SAMPLE: 'false'
    })
  );
  assert.doesNotThrow(() =>
    validateRuntimeConfig({
      ...hosted,
      DEPLOYMENT_ENV: 'prod',
      READINGS_SAMPLE: 'false',
      READINGS_LOCAL_PATH: '/catalog/licensed.yaml'
    })
  );
});

test('production catalogs require all annual dates including leap day', () => {
  const rows = Array.from({ length: 366 }, (_, index) => ({
    ...reflection,
    date: new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(5, 10)
  }));
  assert.equal(
    parseCatalog(JSON.stringify(rows), { requireComplete: true }).byDay.size,
    366
  );
  assert.throws(() =>
    parseCatalog(JSON.stringify(rows.filter((row) => row.date !== '02-29')), {
      requireComplete: true
    })
  );
});

test('cold catalog failures coalesce and back off exponentially with a cap', async () => {
  let clock = 0,
    calls = 0;
  const cache = new ReadingCache(
    async () => {
      calls++;
      throw new Error('Fictional outage');
    },
    { now: () => clock }
  );
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const before = calls;
    await Promise.allSettled([
      cache.get('2028-12-03'),
      cache.get('2028-12-04')
    ]);
    assert.equal(calls, before + 1);
    clock += delay - 1;
    await assert.rejects(cache.get('2028-12-03'));
    assert.equal(calls, before + 1);
    clock++;
  }
});

test('completed replay bypasses changed catalog and quota reservation', async () => {
  const owner = randomUUID(),
    key = randomUUID();
  const repository = new InMemoryShareRepository();
  const input = {
    text: 'Fictional retry.',
    readingDate: reflection.date,
    readingId: reflection.id
  };
  let reservations = 0;
  const authorize = async () => {
    reservations++;
  };
  const source = {
    findByDate: async () => reflection,
    today: async () => ({
      date: reflection.date,
      reading: reflection,
      sample: true
    })
  };
  const request = {
    ownerId: owner,
    input,
    timeZone: 'America/Chicago',
    submissionKey: key
  };
  const first = await createShareService({
    repository,
    readings: source,
    reserveCreate: authorize
  }).save(request);
  const replay = await createShareService({
    repository,
    readings: {
      ...source,
      findByDate: async () => {
        throw new Error('Fictional outage');
      }
    },
    reserveCreate: authorize
  }).save(request);
  assert.deepEqual(replay, first);
  assert.equal(reservations, 1);
});

test('HTTP retries preserve original share and reject changed payload or malformed key', async (t) => {
  useReadingFixture(t);
  const session = await dispatch(
    new Request('http://localhost/api/session', {
      method: 'POST',
      headers: { origin: 'http://localhost' }
    })
  );
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  const key = randomUUID();
  const send = (text: string, requestKey: string = key) =>
    dispatch(
      new Request('http://localhost/api/shares', {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
          'idempotency-key': requestKey
        },
        body: JSON.stringify({ text })
      })
    );
  const first = await send('Fictional retry.');
  assert.equal(first.status, 201);
  const saved = await first.json();
  const retry = await send('Fictional retry.');
  assert.equal(retry.status, 201);
  assert.deepEqual(await retry.json(), saved);
  assert.equal((await send('Changed fictional draft.')).status, 409);
  const malformed = await send('Fictional retry.', 'invalid');
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_IDEMPOTENCY_KEY');
});

test('headers preserve microphone access and separate enforcement from CSP trial', () => {
  const local = new Map(
    securityHeaders(false).map((header) => [header.key, header.value])
  );
  assert.equal(local.get('X-Frame-Options'), 'DENY');
  assert.equal(local.get('X-Content-Type-Options'), 'nosniff');
  assert.ok(
    local
      .get('Permissions-Policy')!
      .split(',')
      .map((value) => value.trim())
      .includes('microphone=(self)')
  );
  assert.ok(
    local
      .get('Content-Security-Policy')!
      .split(';')
      .map((value) => value.trim())
      .includes("frame-ancestors 'none'")
  );
  const connect = local
    .get('Content-Security-Policy-Report-Only')!
    .split(';')
    .map((value) => value.trim().split(' '))
    .find(([name]) => name === 'connect-src');
  assert.ok(connect?.slice(1).includes('https://api.openai.com'));
  assert.equal(local.has('Strict-Transport-Security'), false);
  assert.ok(
    securityHeaders(true).some(
      (header) => header.key === 'Strict-Transport-Security'
    )
  );
});
