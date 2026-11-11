import { z } from 'zod';

export const DEFAULT_READING_TIME_ZONE = 'America/Chicago';
export const READING_TIME_ZONE_COOKIE = 'reading-time-zone';
/** Browser-supplied preferences never select a database table or grant authorization. */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid timezone.');
/** Unset or invalid preference cookies fall back to Central Time. */
export function readingTimeZone(value?: string) {
  try {
    value = value ? decodeURIComponent(value) : undefined;
  } catch {
    return DEFAULT_READING_TIME_ZONE;
  }
  const parsed = timeZoneSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_READING_TIME_ZONE;
}
/** Local calendar dates, including DST transitions; never infer timezone from language headers. */
export function readingDate(
  timeZone = DEFAULT_READING_TIME_ZONE,
  now = Date.now()
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
