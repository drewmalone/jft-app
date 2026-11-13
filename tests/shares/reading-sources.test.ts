import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { localCatalog, s3Catalog } from '../../src/readings/server/sources';
import { MAX_CATALOG_BYTES } from '../../src/readings/server/catalog';

test('local source reads the configured file and retries missing files without allocating unbounded data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'reading-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'catalog.yaml');
  const load = localCatalog(path);
  await assert.rejects(load());
  await writeFile(path, 'readings: []');
  assert.deepEqual(await load(), { content: 'readings: []' });
  await writeFile(path, Buffer.alloc(MAX_CATALOG_BYTES + 1));
  await assert.rejects(load(), /size limit/);
});

test('S3 source selects one object, conditionally revalidates, and propagates authorization failures', async () => {
  let status = 200;
  const client = {
    send: async (command: GetObjectCommand) => {
      assert.deepEqual(command.input, {
        Bucket: 'fictional-bucket',
        Key: 'daily.yaml',
        IfNoneMatch: 'one'
      });
      if (status !== 200) throw { $metadata: { httpStatusCode: status } };
      return {
        Body: Readable.from([Buffer.from('readings: []')]),
        ETag: 'two',
        ContentLength: 12
      };
    }
  } as unknown as Pick<S3Client, 'send'>;
  const load = s3Catalog('fictional-bucket', 'daily.yaml', client);
  assert.deepEqual(await load('one'), { content: 'readings: []', etag: 'two' });
  status = 304;
  assert.deepEqual(await load('one'), { notModified: true });
  status = 403;
  await assert.rejects(load('one'));
});

test('S3 source closes oversized streams including bodies without ContentLength', async () => {
  for (const declaredLength of [undefined, MAX_CATALOG_BYTES + 1]) {
    const body = Readable.from([
      Buffer.alloc(MAX_CATALOG_BYTES),
      Buffer.from('x')
    ]);
    const client = {
      send: async () => ({ Body: body, ContentLength: declaredLength })
    } as unknown as Pick<S3Client, 'send'>;
    await assert.rejects(
      s3Catalog('fictional-bucket', 'daily.yaml', client)(),
      /size limit/
    );
    assert.equal(body.destroyed, true);
  }
});

test('S3 deadline also closes a body stalled after headers arrive', async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  const body = new Readable({ read() {} });
  const client = { send: async () => ({ Body: body }) } as unknown as Pick<
    S3Client,
    'send'
  >;
  const loading = s3Catalog('fictional-bucket', 'daily.yaml', client)();
  await Promise.resolve();
  controller.abort();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(body.destroyed, true);
});
