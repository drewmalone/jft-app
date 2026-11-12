import 'server-only';
import { readingFailureMessage } from './diagnostics';
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
    console.error(`[readings] ${readingFailureMessage(cause)}`);
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
