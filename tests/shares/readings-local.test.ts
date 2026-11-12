import '@hono/zod-openapi';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localCatalog } from '../../src/readings/server/sources';
import { ReadingCache } from '../../src/readings/server/cache';
import { readings } from '../../src/readings/server/configured-readings';
import { readingDate } from '../../src/readings/calendar';
import { dispatch } from '../../src/shares/server/app';
import { shareRepository } from '../../src/shares/server/storage/configured-repository';
import { DynamoDbShareRepository } from '../../src/shares/server/storage/dynamodb-repository';
import { dynamoTable } from './dynamodb-fixture';

test(
  'date-keyed readings are cached across HTTP requests and copied into durable shares',
  { skip: !process.env.DYNAMODB_LOCAL_ENDPOINT },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'readings-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'readings.yaml');
    const shareTable = await dynamoTable(t);
    const shares = new DynamoDbShareRepository(
      shareTable.tableName,
      shareTable.documentClient
    );
    for (const method of ['create', 'findById', 'findByOwner'] as const)
      t.mock.method(shareRepository, method, shares[method].bind(shares));
    let lookups = 0;
    let now = Date.parse('2026-11-11T12:00:00Z');
    const cache = new ReadingCache(
      async () => {
        lookups++;
        return localCatalog(path)();
      },
      { now: () => now }
    );
    t.mock.method(
      readings,
      'findByDate',
      async (date: string) => (await cache.get(date)).reading
    );
    t.mock.method(readings, 'today', async (timeZone: string) => {
      const date = readingDate(timeZone, now);
      return cache.get(date);
    });
    const item = {
      date: '2026-11-11',
      title: 'Fictional imported daily text',
      quote: 'A fictional quotation.',
      source: 'Fictional collection, p. 1',
      body: 'Fictional first paragraph.\n\nFictional second paragraph.'
    };
    const put = (value: typeof item) =>
      writeFile(
        path,
        JSON.stringify([{ ...value, date: value.date.slice(5) }])
      );
    await put(item);
    const request = () =>
      dispatch(
        new Request(
          'http://localhost/api/readings/today?timeZone=America%2FChicago'
        )
      );
    const responses = await Promise.all(Array.from({ length: 8 }, request));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal((await response.json()).reading.body, item.body);
    }
    assert.equal(lookups, 1);
    const saved = await dispatch(
      new Request('http://localhost/api/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Fictional response to the reading.',
          readingDate: item.date
        })
      })
    );
    assert.equal(saved.status, 201);
    const share = await saved.json();
    assert.equal(share.reflection.body, item.body);
    assert.equal(lookups, 1);
    await put({ ...item, body: 'Fictional editorial correction.' });
    assert.equal((await (await request()).json()).reading.body, item.body);
    now += 5 * 60_000;
    assert.equal(
      (await (await request()).json()).reading.body,
      'Fictional editorial correction.'
    );
    assert.equal(lookups, 2);
    const conflict = await dispatch(
      new Request('http://localhost/api/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Fictional draft with an old revision.',
          readingDate: item.date,
          readingId: share.reflection.id
        })
      })
    );
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'READING_CHANGED');
    const privateRead = await dispatch(
      new Request(`http://localhost/api/shares/${share.id}`, {
        headers: { cookie: saved.headers.get('set-cookie')!.split(';')[0] }
      })
    );
    assert.equal((await privateRead.json()).reflection.body, item.body);
    assert.equal((await cache.get('2026-11-12')).reading, null);
    assert.equal((await cache.get('2026-11-12')).reading, null);
    assert.equal(lookups, 2);
  }
);
