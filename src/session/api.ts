import { z } from 'zod';
import { requestJson } from '../http/client';

export async function prepareSession(): Promise<void> {
  z.strictObject({ ready: z.literal(true) }).parse(
    await requestJson('/api/session', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000)
    })
  );
}
