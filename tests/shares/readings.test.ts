import '@hono/zod-openapi';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ReadingCache } from '../../src/readings/server/cache';
import { DynamoReadingRepository } from '../../src/readings/server/repository';
import { readingDate, readingTimeZone } from '../../src/readings/calendar';
import { readings } from '../../src/readings/server/configured-readings';
import { dispatch } from '../../src/shares/server/app';
import { parseReadingsConfig } from '../../src/config/runtime';

const reading = {
  id: 'jft-2026-11-11',
  date: '2026-11-11',
  title: 'Fictional daily reading',
  body: 'A fictional first paragraph.\n\nA fictional second paragraph.'
};

test('calendar selection follows reader timezone, DST, leap days, and Central fallback', () => {
  const now = Date.parse('2026-11-12T02:00:00Z');
  assert.equal(readingDate('America/Chicago', now), '2026-11-11');
  assert.equal(readingDate('Asia/Tokyo', now), '2026-11-12');
  assert.equal(
    readingDate('America/Chicago', Date.parse('2026-03-08T07:59:59Z')),
    '2026-03-08'
  );
  assert.equal(
    readingDate('America/Chicago', Date.parse('2026-03-08T08:00:00Z')),
    '2026-03-08'
  );
  assert.equal(
    readingDate('Pacific/Honolulu', Date.parse('2028-03-01T01:00:00Z')),
    '2028-02-29'
  );
  assert.equal(readingTimeZone('not-a-timezone'), 'America/Chicago');
  assert.equal(readingTimeZone(), 'America/Chicago');
});

test('cache shares in-flight reads, detaches results, caches missing dates, expires and bounds entries', async () => {
  let now = 0;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = new ReadingCache(
    async (date: string) => {
      calls++;
      await gate;
      return date === reading.date ? reading : null;
    },
    () => now,
    100,
    2
  );
  const first = cache.get(reading.date);
  const second = cache.get(reading.date);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  a!.body = 'Mutation';
  assert.equal(b!.body, reading.body);
  assert.equal((await cache.get(reading.date))?.body, reading.body);
  assert.equal(calls, 1);
  assert.equal(await cache.get('2026-11-12'), null);
  assert.equal(await cache.get('2026-11-12'), null);
  assert.equal(calls, 2);
  now = 100;
  await cache.get(reading.date);
  assert.equal(calls, 3);
  await cache.get('2026-11-13');
  await cache.get('2026-11-12');
  assert.equal(calls, 5);
  await assert.rejects(cache.get('2026-02-30'));
});

test('failed reading lookups are not cached and date rollover selects a new key', async () => {
  let calls = 0;
  const cache = new ReadingCache(async (date: string) => {
    if (++calls === 1) throw new Error('Fictional service error');
    return { ...reading, date };
  });
  await assert.rejects(cache.get(reading.date));
  assert.ok(await cache.get(reading.date));
  assert.ok(await cache.get('2026-11-12'));
  assert.equal(calls, 3);
});

test('date-keyed adapter uses GetItem and rejects invalid/mismatched content', async () => {
  let item: unknown = reading;
  const client = {
    send: async (command: GetCommand) => {
      assert.ok(command instanceof GetCommand);
      assert.equal(command.input.TableName, 'fictional-readings');
      assert.deepEqual(command.input.Key, { date: reading.date });
      assert.equal(command.input.ConsistentRead, true);
      return { Item: item };
    }
  } as unknown as Pick<DynamoDBDocumentClient, 'send'>;
  const repository = new DynamoReadingRepository('fictional-readings', client);
  const loaded = await repository.findByDate(reading.date);
  assert.equal(loaded?.date, reading.date);
  assert.equal(loaded?.body, reading.body);
  assert.ok(loaded?.id.startsWith(`jft-${reading.date}-`));
  item = { ...reading, body: 'A fictional revision.' };
  assert.notEqual((await repository.findByDate(reading.date))?.id, loaded?.id);
  item = undefined;
  assert.equal(await repository.findByDate(reading.date), null);
  item = { ...reading, date: '2026-11-12' };
  await assert.rejects(repository.findByDate(reading.date));
  item = { ...reading, body: '' };
  await assert.rejects(repository.findByDate(reading.date));
});

test('reading configuration is explicit and never falls back from invalid DynamoDB settings', () => {
  assert.deepEqual(parseReadingsConfig({}), { READINGS_SOURCE: 'sample' });
  assert.throws(() => parseReadingsConfig({ READINGS_SOURCE: 'unknown' }));
  assert.throws(() => parseReadingsConfig({ READINGS_SOURCE: 'dynamodb' }));
  assert.deepEqual(
    parseReadingsConfig({
      READINGS_SOURCE: 'dynamodb',
      READINGS_TABLE_NAME: 'fictional-readings',
      AWS_REGION: 'us-west-2'
    }),
    {
      READINGS_SOURCE: 'dynamodb',
      READINGS_TABLE_NAME: 'fictional-readings',
      DYNAMODB_REGION: 'us-west-2'
    }
  );
});

test('daily reading API uses requested timezone without a session, and sanitizes failures', async (t) => {
  const selected: string[] = [];
  let failLookups = false;
  let published = true;
  t.mock.method(readings, 'today', async (timeZone: string) => {
    if (failLookups) throw new Error('Fictional raw database diagnostic');
    selected.push(timeZone);
    return {
      date: reading.date,
      reading: published ? reading : null,
      sample: false
    };
  });
  const result = await dispatch(
    new Request('http://localhost/api/readings/today?timeZone=Asia%2FTokyo')
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('set-cookie'), null);
  assert.deepEqual(selected, ['Asia/Tokyo']);
  assert.deepEqual((await result.json()).reading, reading);
  const invalid = await dispatch(
    new Request('http://localhost/api/readings/today?timeZone=invalid')
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_READING_QUERY');
  const head = await dispatch(
    new Request('http://localhost/api/readings/today', { method: 'HEAD' })
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('set-cookie'), null);
  const options = await dispatch(
    new Request('http://localhost/api/readings/today', { method: 'OPTIONS' })
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal(options.headers.get('set-cookie'), null);
  assert.equal(
    (
      await dispatch(
        new Request('http://localhost/api/readings/today', { method: 'POST' })
      )
    ).status,
    405
  );
  published = false;
  const missing = await dispatch(
    new Request('http://localhost/api/readings/today')
  );
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).reading, null);
  failLookups = true;
  const failure = await dispatch(
    new Request('http://localhost/api/readings/today')
  );
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes('raw database'), false);
});

test('saving captures the displayed date across midnight; later content edits cannot change a share', async (t) => {
  const requests: string[] = [];
  let body = reading.body;
  t.mock.method(readings, 'findByDate', async (date: string) => {
    requests.push(date);
    return date === reading.date ? { ...reading, body } : null;
  });
  const result = await dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Fictional thoughts.',
        readingDate: reading.date
      })
    })
  );
  assert.equal(result.status, 201);
  const saved = await result.json();
  assert.deepEqual(saved.reflection, reading);
  assert.deepEqual(requests, [reading.date]);
  body = 'Edited source.';
  const detail = await dispatch(
    new Request(`http://localhost/api/shares/${saved.id}`, {
      headers: { cookie: result.headers.get('set-cookie')!.split(';')[0] }
    })
  );
  assert.equal((await detail.json()).reflection.body, reading.body);
  const invalid = await dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Fictional draft.',
        readingDate: '2026-02-30'
      })
    })
  );
  assert.equal(invalid.status, 400);
});

test('an unpublished selected date rejects saves instead of storing the sample fixture', async (t) => {
  t.mock.method(readings, 'findByDate', async () => null);
  const result = await dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Fictional draft to retain.',
        readingDate: reading.date
      })
    })
  );
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'READING_UNAVAILABLE');
});

test('changed reading revisions fail before writing rather than silently changing the prompt', async (t) => {
  t.mock.method(readings, 'findByDate', async () => ({
    ...reading,
    id: `${reading.id}-revision-2`
  }));
  const { shareRepository } =
    await import('../../src/shares/server/storage/configured-repository');
  const write = t.mock.method(shareRepository, 'create');
  const result = await dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Fictional retained draft.',
        readingDate: reading.date,
        readingId: reading.id
      })
    })
  );
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, 'READING_CHANGED');
  assert.equal(write.mock.callCount(), 0);
});
