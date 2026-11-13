import 'server-only';
import type { z } from 'zod';
import type { createShareSchema } from '../../model';
import type { ReadingService } from '../../../readings/server/service';
import type { ShareRepository } from '../storage/repository';
import { submissionFor } from '../storage/submission';

type SaveRequest = {
  ownerId: string;
  input: z.infer<typeof createShareSchema>;
  timeZone: string;
  submissionKey?: string;
};
type Dependencies = {
  repository: Pick<ShareRepository, 'create' | 'findBySubmission'>;
  readings: ReadingService;
  reserveCreate: (ownerId: string) => Promise<void>;
};
/** Bind dependencies once. Every new write must reserve quota; completed replays skip it. */
export function createShareService(dependencies: Dependencies) {
  return {
    async save({ ownerId, input, timeZone, submissionKey }: SaveRequest) {
      const submission = submissionKey
        ? submissionFor(submissionKey, input)
        : undefined;
      if (submission) {
        const previous = await dependencies.repository.findBySubmission(
          ownerId,
          submission
        );
        if (previous) return { share: previous } as const;
      }
      let reading;
      try {
        reading = input.readingDate
          ? await dependencies.readings.findByDate(input.readingDate)
          : (await dependencies.readings.today(timeZone)).reading;
      } catch {
        return { error: 'READING_UNAVAILABLE' } as const;
      }
      if (!reading) return { error: 'READING_UNAVAILABLE' } as const;
      if (input.readingId && reading.id !== input.readingId)
        return { error: 'READING_CHANGED' } as const;
      await dependencies.reserveCreate(ownerId);
      return {
        share: await dependencies.repository.create(
          ownerId,
          input.text,
          reading,
          submission
        )
      } as const;
    }
  };
}
export type ShareService = ReturnType<typeof createShareService>;
