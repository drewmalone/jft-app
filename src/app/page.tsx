import { getServerServices } from '../server/services';
import { cookies } from 'next/headers';
import {
  readingTimeZone,
  readingDate,
  READING_TIME_ZONE_COOKIE
} from '../readings/calendar';
import type { DailyReading } from '../readings/model';
import { ShareApp } from '../shares/share-app';
import { connection } from 'next/server';
import { TranscriptionBootstrap } from '../shares/transcription/provider-context';

/** The browser must choose Soniox WebSocket or OpenAI WebRTC for direct audio.
 * Serialize only the non-secret provider name; credentials are issued after Record.
 * A backend-only adapter would require proxying microphone audio through Amplify.
 */
export default async function Home() {
  await connection();
  const services = getServerServices();
  const timeZone = readingTimeZone(
    (await cookies()).get(READING_TIME_ZONE_COOKIE)?.value
  );
  let daily: DailyReading;
  try {
    daily = await services.readings.today(timeZone);
  } catch {
    daily = { date: readingDate(timeZone), reading: null, sample: false };
  }
  return (
    <TranscriptionBootstrap provider={services.features.transcription.provider}>
      <ShareApp
        initialReading={daily}
        cleanupEnabled={
          services.features.cleanup.enabled &&
          !services.features.cleanup.disabled
        }
      />
    </TranscriptionBootstrap>
  );
}
