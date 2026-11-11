import '@hono/zod-openapi';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoReadingRepository } from '../../src/readings/server/repository';
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
    const readingTable = await dynamoTable(t, 'date');
    const shareTable = await dynamoTable(t, 'id');
    const shares = new DynamoDbShareRepository(
      shareTable.tableName,
      shareTable.documentClient
    );
    for (const method of ['create', 'findById', 'findByOwner'] as const)
      t.mock.method(shareRepository, method, shares[method].bind(shares));
    let lookups = 0;
    const client = {
      send: async (command: GetCommand) => {
        lookups++;
        return readingTable.documentClient.send(command);
      }
    };
    const repository = new DynamoReadingRepository(
      readingTable.tableName,
      client
    );
    let now = Date.parse('2026-11-11T12:00:00Z');
    const cache = new ReadingCache(
      repository.findByDate.bind(repository),
      () => now
    );
    t.mock.method(readings, 'findByDate', cache.get.bind(cache));
    t.mock.method(readings, 'today', async (timeZone: string) => {
      const date = readingDate(timeZone, now);
      return { date, reading: await cache.get(date), sample: false };
    });
    const item = {
      date: '2026-11-11',
      title: 'Fictional imported daily text',
      body: 'Fictional first paragraph.\n\nFictional second paragraph.'
    };
    const put = (value: typeof item) =>
      readingTable.documentClient.send(
        new PutCommand({ TableName: readingTable.tableName, Item: value })
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
    assert.equal(await cache.get('2026-11-12'), null);
    assert.equal(await cache.get('2026-11-12'), null);
    assert.equal(lookups, 3);
  }
);
