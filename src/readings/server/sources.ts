import 'server-only';
import { createReadStream } from 'node:fs';
import { addAbortSignal, type Readable } from 'node:stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MAX_CATALOG_BYTES } from './catalog';

export type CatalogLoad = (
  etag?: string
) => Promise<{ content: string; etag?: string } | { notModified: true }>;
/** Bound memory and close the stream on success, overflow or transport failure. */
async function readCatalogStream(
  stream: Readable,
  contentLength?: number,
  signal: AbortSignal = AbortSignal.timeout(15_000)
): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    addAbortSignal(signal, stream);
    if (contentLength !== undefined && contentLength > MAX_CATALOG_BYTES)
      throw new Error('Reading catalog exceeds the size limit.');
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > MAX_CATALOG_BYTES)
        throw new Error('Reading catalog exceeds the size limit.');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    stream.destroy();
  }
}
/** Local files and S3 objects share the same bounded reader. */
export function localCatalog(path: string): CatalogLoad {
  return async () => ({
    content: await readCatalogStream(createReadStream(path))
  });
}
/** Conditional whole-object reads; the caller owns validation and last-good publication. */
export function s3Catalog(
  bucket: string,
  key: string,
  client: Pick<S3Client, 'send'>
): CatalogLoad {
  return async (etag) => {
    const signal = AbortSignal.timeout(15_000);
    try {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          IfNoneMatch: etag
        }),
        { abortSignal: signal }
      );
      if (!result.Body) throw new Error('Missing reading catalog body.');
      return {
        content: await readCatalogStream(
          result.Body as Readable,
          result.ContentLength,
          signal
        ),
        etag: result.ETag
      };
    } catch (cause) {
      if (
        etag &&
        typeof cause === 'object' &&
        cause !== null &&
        '$metadata' in cause &&
        (cause.$metadata as { httpStatusCode?: number } | undefined)
          ?.httpStatusCode === 304
      )
        return { notModified: true };
      throw cause;
    }
  };
}
