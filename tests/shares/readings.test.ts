import '@hono/zod-openapi';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { readFile } from 'node:fs/promises';
import { readingSchema } from '../../src/readings/model';
import { parseCatalog } from '../../src/readings/server/catalog';
import { ReadingCache } from '../../src/readings/server/cache';
import { readingDate, readingTimeZone } from '../../src/readings/calendar';
import { readings } from '../../src/readings/server/configured-readings';
import { dispatch } from '../../src/server/app';
import { parseReadingsConfig } from '../../src/config/runtime';

const reading = {
  id: 'jft-2026-11-11',
  date: '2026-11-11',
  title: 'Fictional daily reading',
  quote: 'A fictional quotation.',
  source: 'Fictional collection, p. 1',
  body: 'A fictional first paragraph.\n\nA fictional second paragraph.'
};

const catalogReading = { ...reading, date: '11-11' };

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

test('catalog refresh coalesces callers across dates, preserves last-good data and retries initial failures', async () => {
  let now = 0,
    calls = 0;
  let content = JSON.stringify([catalogReading]);
  let fail = true;
  const cache = new ReadingCache(
    async () => {
      calls++;
      if (fail) throw new Error('Fictional outage');
      return { content, etag: 'revision-one' };
    },
    { now: () => now, lifetimeMs: 100 }
  );
  await assert.rejects(cache.get(reading.date));
  await assert.rejects(cache.get(reading.date));
  assert.equal(calls, 1);
  now = 1000;
  fail = false;
  const [first, missing] = await Promise.all([
    cache.get(reading.date),
    cache.get('2026-11-12')
  ]);
  assert.equal(calls, 2);
  assert.equal(missing.reading, null);
  first.reading!.body = 'Mutation';
  assert.equal((await cache.get(reading.date)).reading!.body, reading.body);
  now = 1100;
  content = 'invalid: [';
  assert.equal((await cache.get(reading.date)).reading!.body, reading.body);
  assert.equal(calls, 3);
  await cache.get('2026-11-12');
  assert.equal(calls, 3);
  now = 1200;
  content = JSON.stringify([
    { ...catalogReading, body: 'Fictional correction' }
  ]);
  const corrected = (await cache.get(reading.date)).reading!;
  assert.notEqual(corrected.id, first.reading!.id);
  assert.equal(corrected.body, 'Fictional correction');
  await assert.rejects(cache.get('2026-02-30'));
});

test('unchanged catalogs reuse validated content and send only the last validated ETag', async () => {
  let now = 0,
    calls = 0;
  const cache = new ReadingCache(
    async (etag) => {
      if (calls++ === 0) {
        assert.equal(etag, undefined);
        return {
          content: JSON.stringify([catalogReading]),
          etag: 'one'
        };
      }
      assert.equal(etag, 'one');
      return { notModified: true };
    },
    { now: () => now, lifetimeMs: 100 }
  );
  const first = await cache.get(reading.date);
  now = 100;
  assert.deepEqual(await cache.get(reading.date), first);
  assert.equal(calls, 2);
});

test('catalog validation rejects duplicates, invalid dates, blank bodies and malformed YAML', () => {
  for (const content of [
    JSON.stringify([catalogReading, catalogReading]),
    JSON.stringify([{ ...catalogReading, date: '02-30' }]),
    JSON.stringify([{ ...catalogReading, body: '  ' }]),
    'readings: []\nreadings: []',
    'readings: ['
  ])
    assert.throws(() => parseCatalog(content));
  assert.equal(parseCatalog(JSON.stringify([])).byDay.size, 0);
});

test('reading configuration selects local or S3 independently of share persistence', () => {
  assert.equal(parseReadingsConfig({}).READINGS_SOURCE, 'local');
  assert.throws(() => parseReadingsConfig({ READINGS_SOURCE: 'unknown' }));
  assert.throws(() => parseReadingsConfig({ READINGS_SOURCE: 's3' }));
  assert.deepEqual(
    parseReadingsConfig({
      READINGS_SAMPLE: 'false',
      READINGS_SOURCE: 's3',
      READINGS_S3_BUCKET: 'fictional-readings',
      AWS_REGION: 'us-east-2',
      DYNAMODB_REGION: 'us-west-2'
    }),
    {
      READINGS_SAMPLE: 'false',
      READINGS_SOURCE: 's3',
      READINGS_S3_BUCKET: 'fictional-readings',
      READINGS_S3_KEY: 'just-for-today.yaml',
      READINGS_REGION: 'us-east-2'
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

test('bare-list YAML preserves quotations and sources, hashes revisions, and accepts legacy saved snapshots', async () => {
  const content = await readFile(
    'infra/terraform/readings.example.yaml',
    'utf8'
  );
  assert.ok(Array.isArray(parse(content)));
  const first = parseCatalog(content).byDay.values().next().value!;
  assert.ok(first.quote);
  assert.ok(first.source);
  const rows = parse(content);
  rows[0].quote += ' Fictional correction.';
  assert.notEqual(
    parseCatalog(JSON.stringify(rows)).byDay.get(first.date)!.revision,
    first.revision
  );
  rows[0].quote = first.quote;
  rows[0].source += ' Fictional correction.';
  assert.notEqual(
    parseCatalog(JSON.stringify(rows)).byDay.get(first.date)!.revision,
    first.revision
  );
  for (const field of ['quote', 'source']) {
    const invalid = { ...catalogReading, [field]: '' };
    assert.throws(() => parseCatalog(JSON.stringify([invalid])));
    delete invalid[field as keyof typeof invalid];
    assert.throws(() => parseCatalog(JSON.stringify([invalid])));
  }
  const legacy = {
    id: reading.id,
    date: reading.date,
    title: reading.title,
    body: reading.body
  };
  assert.deepEqual(readingSchema.parse(legacy), legacy);
  assert.throws(() => parseCatalog(JSON.stringify({ readings: [reading] })));
});

test('annual month-day readings recur across years while snapshots keep their full selected date', async () => {
  const cache = new ReadingCache(async () => ({
    content: JSON.stringify([
      { ...catalogReading, date: '12-03' },
      { ...catalogReading, date: '02-29' }
    ])
  }));
  const first = (await cache.get('2028-12-03')).reading!;
  const nextYear = (await cache.get('2029-12-03')).reading!;
  assert.equal(first.date, '2028-12-03');
  assert.equal(nextYear.date, '2029-12-03');
  assert.equal(first.body, nextYear.body);
  assert.notEqual(first.id, nextYear.id);
  assert.equal((await cache.get('2028-02-29')).reading?.date, '2028-02-29');
  assert.equal((await cache.get('2029-02-28')).reading, null);
  assert.equal((await cache.get('2029-03-01')).reading, null);
  await assert.rejects(cache.get('2029-02-29'));
  for (const date of ['2028-12-03', '2-03', '02-30', '04-31', '13-01'])
    assert.throws(() =>
      parseCatalog(JSON.stringify([{ ...catalogReading, date }]))
    );
});
