import 'server-only';
import { open } from 'node:fs/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MAX_CATALOG_BYTES } from './catalog';

export type CatalogLoad = (
  etag?: string
) => Promise<{ content: string; etag?: string } | { notModified: true }>;
/** Read from a configured local path; bound allocation even if the file grows during a read. */
export function localCatalog(path: string): CatalogLoad {
  return async () => {
    const file = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(MAX_CATALOG_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          length,
          buffer.length - length,
          null
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_CATALOG_BYTES)
        throw new Error('Reading catalog exceeds the size limit.');
      return { content: buffer.toString('utf8', 0, length) };
    } finally {
      await file.close();
    }
  };
}
/** Conditional whole-object reads; the caller owns validation and last-good publication. */
export function s3Catalog(
  bucket: string,
  key: string,
  client: Pick<S3Client, 'send'>
): CatalogLoad {
  return async (etag) => {
    try {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          IfNoneMatch: etag
        }),
        { abortSignal: AbortSignal.timeout(15_000) }
      );
      if (!result.Body) throw new Error('Missing reading catalog body.');
      try {
        if (
          result.ContentLength !== undefined &&
          result.ContentLength > MAX_CATALOG_BYTES
        )
          throw new Error('Reading catalog exceeds the size limit.');
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
          length += chunk.length;
          if (length > MAX_CATALOG_BYTES)
            throw new Error('Reading catalog exceeds the size limit.');
          chunks.push(Buffer.from(chunk));
        }
        return {
          content: Buffer.concat(chunks).toString('utf8'),
          etag: result.ETag
        };
      } finally {
        (result.Body as { destroy?: () => void }).destroy?.();
      }
    } catch (cause) {
      if (
        etag &&
        typeof cause === 'object' &&
        cause !== null &&
        '$metadata' in cause &&
        (cause.$metadata as { httpStatusCode?: number }).httpStatusCode === 304
      )
        return { notModified: true };
      throw cause;
    }
  };
}
