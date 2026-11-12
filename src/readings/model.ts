import { z } from 'zod';

const text = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'Text must not be blank.');
/** Date-keyed editorial content, independent of anonymous shares. */
const readingTextSchema = z.object({
  date: z.iso.date(),
  title: text(500),
  body: text(50_000)
});
/** New publications require the quotation and its attribution. */
export const dailyTextSchema = readingTextSchema.extend({
  date: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .refine(
      (value) => z.iso.date().safeParse(`2000-${value}`).success,
      'Use a valid MM-DD, including 02-29 for leap day.'
    ),
  quote: text(5000),
  source: text(1000)
});
/** A share captures this complete snapshot, including its stable reading ID. */
export const readingSchema = readingTextSchema.extend({
  id: text(500),
  // Older saved snapshots predate quotation fields.
  quote: text(5000).optional(),
  source: text(1000).optional()
});
export type Reading = z.infer<typeof readingSchema>;
export const dailyReadingSchema = z.object({
  date: z.iso.date(),
  reading: readingSchema.nullable(),
  sample: z.boolean()
});
export type DailyReading = z.infer<typeof dailyReadingSchema>;
