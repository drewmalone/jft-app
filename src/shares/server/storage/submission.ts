import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { createShareSchema } from '../../model';

export type Submission = { key: string; requestHash: string };
const conflictTag = Symbol.for('doorknob.submission-conflict');
export class SubmissionConflict extends Error {
  readonly [conflictTag] = true;
  constructor() {
    super('Submission already used for a different request');
  }
}
/** Shared runtime objects can originate in another Next bundle or development reload. */
export function isSubmissionConflict(
  cause: unknown
): cause is SubmissionConflict {
  return cause instanceof Error && Reflect.get(cause, conflictTag) === true;
}
/** Keys and payload fingerprints remain server-side metadata; never log them. */
export function submissionFor(
  key: string,
  input: z.infer<typeof createShareSchema>
): Submission {
  z.uuid({ version: 'v4' }).parse(key);
  return {
    key,
    requestHash: createHash('sha256')
      .update(
        JSON.stringify([
          input.text.trim(),
          input.readingDate ?? null,
          input.readingId ?? null
        ])
      )
      .digest('hex')
  };
}
export function submissionId(owner: string, submission: Submission) {
  z.uuid().parse(owner);
  z.uuid({ version: 'v4' }).parse(submission.key);
  return `submission:${createHash('sha256')
    .update(JSON.stringify([owner, submission.key]))
    .digest('hex')}`;
}
export const submissionRecordSchema = z.strictObject({
  id: z.templateLiteral(['submission:', z.hash('sha256')]),
  requestHash: z.hash('sha256'),
  shareId: z.uuid({ version: 'v4' })
});
