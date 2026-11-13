import 'server-only';
import type { ReadingCache } from './cache';
import { readingFailureMessage } from './diagnostics';
import { readingDate } from '../calendar';

/** The service owns safe diagnostics and calendar selection; the cache owns publication loading. */
export function createReadingService(cache: Pick<ReadingCache, 'get'>) {
  async function get(date: string) {
    try {
      return await cache.get(date);
    } catch (cause) {
      console.error(`[readings] ${readingFailureMessage(cause)}`);
      throw cause;
    }
  }
  return {
    async findByDate(date: string) {
      return (await get(date)).reading;
    },
    today(timeZone: string, now = Date.now()) {
      return get(readingDate(timeZone, now));
    }
  };
}
export type ReadingService = ReturnType<typeof createReadingService>;
