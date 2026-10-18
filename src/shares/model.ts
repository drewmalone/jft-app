import { z } from 'zod';

const nonblankText = z.string().refine((value) => value.trim().length > 0, {
  message: 'Text must not be blank'
});
const reflectionSchema = z.object({
  id: nonblankText,
  date: z.iso.date(),
  title: nonblankText,
  body: nonblankText
});

/** Only text is accepted from the browser; metadata is assigned by the server. */
export const createShareSchema = z.strictObject({
  text: z.string().trim().min(1, 'Write a few words before saving your share.')
});

/** Public-to-the-owner API representation; session ownership stays on the server. */
export const shareSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  kind: z.literal('text'),
  reflection: reflectionSchema,
  text: nonblankText
});

/** A reading snapshot, independent of the current hardcoded reading. */
export type Reflection = z.infer<typeof reflectionSchema>;
/** A private text share returned to its owner. */
export type Share = z.infer<typeof shareSchema>;

/** Fixed placeholder reading, copied into every saved share. */
export const reflection: Reflection = {
  id: 'acceptance-2025-04-23',
  date: '2025-04-23',
  title: 'Acceptance is the answer to all my problems today.',
  body: 'Today, I can practice meeting life as it is. Acceptance gives me room to pause, let go of what I cannot change, and take one small step toward what I can.'
};
