import { z } from 'zod';
import type { TranscriptionEvents } from '../../types';

const word = z.object({
  text: z.string().max(10_000),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().nonnegative()
});
const partial = z.object({
  type: z.literal('transcript.partial'),
  text: z.string().max(20_000),
  start: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  is_final: z.boolean(),
  speech_final: z.boolean()
});
const done = z.object({
  type: z.literal('transcript.done'),
  text: z.string().max(20_000),
  duration: z.number().finite().nonnegative(),
  words: z.array(word).max(10_000).optional()
});
const EPSILON = 0.001;

/**
 * Chunk finals are locked fragments, while speech_final contains the stitched utterance.
 * Keep fragments provisional until that boundary, then append the utterance once.
 * WebSocket preserves wire order. Conflicting/late overlapping finals fail rather than
 * silently appending words in the wrong order. Done is a session summary, not another segment.
 */
export function createXaiProtocol(
  events: Pick<TranscriptionEvents, 'interim' | 'final' | 'activity'>
) {
  let committedEnd = 0;
  let committedText = '';
  const committedUtterances = new Set<string>();
  const chunks = new Map<
    number,
    { end: number; text: string; locked: boolean }
  >();
  function emit(text: string) {
    if (!text.trim()) return;
    committedText = [committedText, text.trim()].filter(Boolean).join(' ');
    events.final(text.trim());
  }
  return {
    /** Preserve provider-locked fragments if an interruption prevents the stitched utterance. */
    retainLocked() {
      const pending = [...chunks.entries()].sort(([a], [b]) => a - b);
      chunks.clear();
      for (const [start, chunk] of pending) {
        if (!chunk.locked || start < committedEnd - EPSILON) continue;
        committedEnd = chunk.end;
        emit(chunk.text);
      }
    },
    /** Returns true only for the terminal transcript.done event. Throws on unsafe protocol data. */
    accept(value: unknown): boolean {
      if (!value || typeof value !== 'object' || !('type' in value))
        throw new Error('Invalid transcription event');
      if (value.type === 'error') throw new Error('Transcription failed');
      if (value.type === 'transcript.partial') {
        const result = partial.parse(value);
        const end = result.start + result.duration;
        if (result.speech_final && !result.is_final)
          throw new Error('Invalid final flags');
        if (end <= committedEnd + EPSILON) {
          if (
            result.speech_final &&
            !committedUtterances.has(`${result.start}:${end}`)
          )
            throw new Error('Out of order finalized utterance');
          return false;
        }
        if (result.start < committedEnd - EPSILON)
          throw new Error('Overlapping transcription');
        if (result.speech_final) {
          if (
            [...chunks.keys()].some((start) => start < result.start - EPSILON)
          )
            throw new Error('Out of order transcription');
          committedEnd = end;
          committedUtterances.add(`${result.start}:${end}`);
          for (const [start, chunk] of chunks)
            if (chunk.end <= end + EPSILON) chunks.delete(start);
          events.interim('');
          emit(result.text);
          events.activity?.(false);
        } else {
          const prior = chunks.get(result.start);
          if (prior && end < prior.end - EPSILON) return false;
          if (!prior?.locked)
            chunks.set(result.start, {
              end,
              text: result.text,
              locked: result.is_final
            });
          if (chunks.size > 256) throw new Error('Too many pending fragments');
          events.interim(
            [...chunks.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, chunk]) => chunk.text)
              .join(' ')
          );
          events.activity?.(Boolean(result.text));
        }
        return false;
      }
      if (value.type === 'transcript.done') {
        const result = done.parse(value);
        events.interim('');
        if (!committedText) emit(result.text);
        else if (result.text.trim() !== committedText) {
          if (result.words?.length) {
            const words = [...result.words].sort((a, b) => a.start - b.start);
            if (
              words.some(
                (w) =>
                  w.end < w.start ||
                  (w.start < committedEnd - EPSILON &&
                    w.end > committedEnd + EPSILON)
              )
            )
              throw new Error('Overlapping summary');
            emit(
              words
                .filter((w) => w.start >= committedEnd - EPSILON)
                .map((w) => w.text)
                .join(' ')
            );
          } else if (result.text.startsWith(committedText + ' ')) {
            emit(result.text.slice(committedText.length).trim());
          } else throw new Error('Cannot safely reconcile final transcript');
        }
        chunks.clear();
        return true;
      }
      throw new Error('Unexpected transcription event');
    }
  };
}
