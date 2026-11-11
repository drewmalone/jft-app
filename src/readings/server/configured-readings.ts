import 'server-only';
import { parseReadingsConfig } from '../../config/runtime';
import { reflection } from '../sample-reading';
import { readingDate } from '../calendar';
import type { DailyReading, Reading } from '../model';
import { ReadingCache } from './cache';
import { DynamoReadingRepository } from './repository';

const processState = globalThis as typeof globalThis & {
  dailyReadings?: { cache: ReadingCache; sample: boolean };
};
function current() {
  if (!processState.dailyReadings) {
    const config = parseReadingsConfig(process.env);
    const source =
      config.READINGS_SOURCE === 'sample'
        ? null
        : DynamoReadingRepository.forRegion(
            config.READINGS_TABLE_NAME,
            config.DYNAMODB_REGION
          );
    processState.dailyReadings = {
      cache: new ReadingCache(
        source ? source.findByDate.bind(source) : async () => reflection
      ),
      sample: !source
    };
  }
  return processState.dailyReadings;
}
/** Shared server entry point. The table/cache are selected lazily, without build-time AWS access. */
export const readings = {
  findByDate(date: string): Promise<Reading | null> {
    return current().cache.get(date);
  },
  async today(timeZone: string, now = Date.now()): Promise<DailyReading> {
    const date = readingDate(timeZone, now);
    return {
      date,
      reading: await this.findByDate(date),
      sample: current().sample
    };
  }
};
