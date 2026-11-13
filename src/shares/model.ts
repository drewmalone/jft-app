import { z } from 'zod';
import { readingSchema } from '../readings/model';

/** Maximum raw text length in Unicode code points, before surrounding whitespace is trimmed. */
export const MAX_SHARE_TEXT_LENGTH = 10_000;

const nonblankText = z.string().refine((value) => value.trim().length > 0, {
  message: 'Text must not be blank'
});
/** Accept text and optional reading date/revision selectors; the server supplies the authoritative snapshot. */
export const createShareSchema = z.strictObject({
  tidy: z.boolean().optional().meta({
    description:
      'Opt in to server-side copyediting before saving; requires an exact Origin and an existing session. Cleanup is skipped when transcription is disabled.'
  }),
  readingDate: z.iso.date().optional(),
  readingId: z.string().min(1).max(500).optional(),
  text: z
    .string()
    .refine(
      (value) => Array.from(value).length <= MAX_SHARE_TEXT_LENGTH,
      'Text exceeds 10,000 characters'
    )
    .trim()
    .min(1, 'Write a few words before saving your share.')
    .meta({
      maxLength: MAX_SHARE_TEXT_LENGTH,
      description:
        'At most 10,000 Unicode code points before trimming; the trimmed result must contain non-whitespace text.'
    })
});

/** Strip server-only fields such as ownerId; callers must check ownership separately. */
export const shareSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  kind: z.literal('text'),
  reflection: readingSchema,
  text: nonblankText,
  shareUrl: z
    .string()
    .regex(
      /^\/s\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
});

/** Reading snapshot with an ISO calendar date; saved snapshots do not follow later edits. */
export type Reflection = z.infer<typeof readingSchema>;

export type Share = z.infer<typeof shareSchema>;

/** Public projection: no ID, owner, creation metadata, or history. Authorization is server-only. */
export const publicShareSchema = shareSchema.pick({
  reflection: true,
  text: true
});
