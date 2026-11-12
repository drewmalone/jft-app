import 'server-only';
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
          )
    );
  }
  return processState.dailyReadings;
}
/** Lazily load on the first request, never during a build. Each process retains the validated catalog. */
export const readings = {
  async findByDate(date: string) {
    return (await current().get(date)).reading;
  },
  today(timeZone: string, now = Date.now()) {
    return current().get(readingDate(timeZone, now));
  }
};
