import 'server-only';
import { readingFailureMessage } from './diagnostics';
import { serverServices } from '../../server/services';
import { readingDate } from '../calendar';

/** Keep configuration, catalog and transport details server-side without logging reading text or raw SDK errors. */
async function getReading(date: string) {
  try {
    return await serverServices.readings.get(date);
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
