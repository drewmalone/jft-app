import { submissionFor } from '../storage/submission';
import 'server-only';
import type { z } from 'zod';
import type { createShareSchema } from '../../model';
import { readings } from '../../../readings/server/configured-readings';
import { shareRepository } from '../storage/configured-repository';
import type { ShareRepository } from '../storage/repository';

/** Select server-owned content and validate its revision before writing a snapshot. Storage failures propagate. */
export async function createShareForReading(
  ownerId: string,
  input: z.infer<typeof createShareSchema>,
  timeZone: string,
  source: Pick<typeof readings, 'findByDate' | 'today'> = readings,
  repository: Pick<
    ShareRepository,
    'create' | 'findBySubmission'
  > = shareRepository,
  submissionKey?: string,
  authorizeCreate: () => Promise<void> = async () => {}
) {
  const submission = submissionKey
    ? submissionFor(submissionKey, input)
    : undefined;
  if (submission) {
    const previous = await repository.findBySubmission(ownerId, submission);
    if (previous) return { share: previous } as const;
  }
  let reading;
  try {
    reading = input.readingDate
      ? await source.findByDate(input.readingDate)
      : (await source.today(timeZone)).reading;
  } catch {
    return { error: 'READING_UNAVAILABLE' } as const;
  }
  if (!reading) return { error: 'READING_UNAVAILABLE' } as const;
  if (input.readingId && reading.id !== input.readingId)
    return { error: 'READING_CHANGED' } as const;
  await authorizeCreate();
  return {
    share: await repository.create(ownerId, input.text, reading, submission)
  } as const;
}
