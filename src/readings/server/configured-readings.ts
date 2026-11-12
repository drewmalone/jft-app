import 'server-only';
import { ZodError } from 'zod';
import { S3Client } from '@aws-sdk/client-s3';
import { parseReadingsConfig } from '../../config/runtime';
import { readingDate } from '../calendar';
import { ReadingCache } from './cache';
import { localCatalog, s3Catalog } from './sources';

const processState = globalThis as typeof globalThis & {
  dailyReadings?: ReadingCache;
};
function current() {
  if (!processState.dailyReadings) {
    const config = parseReadingsConfig(process.env);
    processState.dailyReadings = new ReadingCache(
      config.READINGS_SOURCE === 'local'
        ? localCatalog(config.READINGS_LOCAL_PATH)
        : s3Catalog(
            config.READINGS_S3_BUCKET,
            config.READINGS_S3_KEY,
            new S3Client({ region: config.READINGS_REGION })
          ),
      { sample: config.READINGS_SAMPLE === 'true' }
    );
  }
  return processState.dailyReadings;
}
/** Keep configuration, catalog and transport details server-side without logging reading text or raw SDK errors. */
async function getReading(date: string) {
  try {
    return await current().get(date);
  } catch (cause) {
    if (cause instanceof ZodError) {
      console.error(
        '[readings] Invalid configuration or catalog. Expected a YAML list with MM-DD date, title, quote, source and body.',
        {
          issues: cause.issues.slice(0, 10).map((issue) => ({
            field: issue.path.join('.') || '(root)',
            code: issue.code
          }))
        }
      );
    } else {
      const code =
        typeof cause === 'object' && cause !== null && 'code' in cause
          ? cause.code
          : undefined;
      const message = cause instanceof Error ? cause.message : '';
      const reason =
        code === 'ENOENT'
          ? 'File not found: check READINGS_LOCAL_PATH relative to the app working directory.'
          : code === 'EACCES'
            ? 'The configured readings file is not readable.'
            : code === 'EISDIR'
              ? 'READINGS_LOCAL_PATH points to a directory, not a YAML file.'
              : message === 'Invalid reading YAML.'
                ? 'Malformed YAML or duplicate YAML keys.'
                : message === 'Duplicate reading date.'
                  ? 'Duplicate reading date in the catalog.'
                  : message === 'Reading catalog exceeds the size limit.'
                    ? 'Catalog exceeds the 10 MiB limit.'
                    : 'Source request failed: check local file access or S3 bucket, key, region and role permissions.';
      console.error('[readings] Catalog load failed.', { reason });
    }
    throw cause;
  }
}
/** Lazily load on the first request, never during a build. Each process retains the validated catalog. */
export const readings = {
  async findByDate(date: string) {
    return (await getReading(date)).reading;
  },
  today(timeZone: string, now = Date.now()) {
    return getReading(readingDate(timeZone, now));
  }
};
