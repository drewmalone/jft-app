import { relayLimits } from '../../shared/xai-relay/contract.mjs';
import { z } from 'zod';

const time = z.number().finite().nonnegative();
const text = z.string().max(relayLimits.maxTextCharacters);
const words = z
  .array(z.object({ text, start: time, end: time }))
  .max(10_000)
  .optional();
const partial = z.object({
  text,
  words,
  start: time,
  duration: time,
  is_final: z.boolean(),
  speech_final: z.boolean()
});
const summary = z.object({ text, words, duration: time });
const EPSILON = 0.001;

/**
 * xAI alone owns chunk/utterance/summary semantics. Locked chunks commit immediately;
 * cumulative utterances and the terminal summary contribute only previously unseen audio.
 * No reconnect or replay occurs: WebSocket delivery order is the audio event order.
 * @param {{interim(text: string): void, final(text: string): void}} events
 */
export function createXaiTranscript(events) {
  let position = 0;
  /** @type {{start: number, end: number, text: string}[]} */
  const chunks = [];
  /** @param {{text: string, start?: number, words?: {text: string, start: number, end: number}[]}} result */
  function remaining(result, start = result.start ?? 0) {
    if (start >= position - EPSILON || !chunks.length)
      return result.text.trim();
    if (result.words?.length) {
      const ordered = [...result.words].sort((a, b) => a.start - b.start);
      if (
        ordered.some(
          (word, i) =>
            word.end < word.start ||
            (word.start < position - EPSILON &&
              word.end > position + EPSILON) ||
            (i > 0 && word.start < ordered[i - 1].end - EPSILON)
        )
      )
        throw new Error('Ambiguous word timestamps');
      return ordered
        .filter((word) => word.start >= position - EPSILON)
        .map((word) => word.text)
        .join(' ');
    }
    // Match only chunks inside this cumulative interval, including summaries starting at zero.
    const prefix = chunks
      .filter((chunk) => chunk.start >= start - EPSILON)
      .map((chunk) => chunk.text)
      .filter(Boolean)
      .join(' ');
    if (
      prefix &&
      (result.text === prefix || result.text.startsWith(prefix + ' '))
    )
      return result.text.slice(prefix.length).trim();
    throw new Error('Cannot safely reconcile cumulative transcript');
  }
  /** @param {{text: string, duration: number, start?: number, words?: {text: string, start: number, end: number}[]}} result */
  function commit(result, start = result.start ?? 0) {
    const end = start + result.duration;
    if (end <= position + EPSILON) return;
    const value = remaining(result, start);
    if (chunks.length >= 4096) throw new Error('Too many chunks');
    chunks.push({ start: Math.max(start, position), end, text: value });
    position = end;
    if (value) events.final(value);
    events.interim('');
  }
  return {
    /** Throws on malformed/conflicting provider data; returns true only for transcript.done. @param {unknown} event */
    accept(event) {
      if (!event || typeof event !== 'object' || !('type' in event))
        throw new Error('Invalid transcript event');
      if (event.type === 'transcript.partial') {
        const result = partial.parse(event);
        const end = result.start + result.duration;
        if (result.speech_final && !result.is_final)
          throw new Error('Invalid final flags');
        if (end <= position + EPSILON) {
          if (
            result.is_final &&
            !result.speech_final &&
            !chunks.some(
              (chunk) => chunk.start === result.start && chunk.end === end
            )
          )
            throw new Error('Out of order locked chunk');
          return false;
        }
        if (result.is_final) {
          commit(result);
        } else events.interim(remaining(result));
        return false;
      }
      if (event.type !== 'transcript.done')
        throw new Error('Unexpected transcription event');
      commit(summary.parse(event), 0);
      return true;
    }
  };
}
