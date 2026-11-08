import type { RealtimeResult } from '@soniox/client';
import type { TranscriptionEvents } from '../../types';

/** Soniox results contain new finals and a replacement provisional suffix.
 * Keep the last lexical unit until a boundary so split words/punctuation are
 * never separated by the editor's segment separator. No text-based dedup: a
 * speaker can legitimately repeat a word. Timed retransmissions are ignored.
 */
export function createSonioxProtocol(events: TranscriptionEvents) {
  const words = new Intl.Segmenter('en', { granularity: 'word' });
  let pending = '';
  let provisional = '';
  const seen = new Set<string>();
  const flush = () => {
    const text = pending;
    pending = '';
    if (text.trim()) events.final(text);
  };
  return {
    accept(result: RealtimeResult) {
      provisional = '';
      for (const token of result.tokens) {
        if (token.text === '<end>' || token.text === '<fin>') continue;
        if (!token.is_final) {
          provisional += token.text;
          continue;
        }
        if (token.start_ms !== undefined && token.end_ms !== undefined) {
          const id = JSON.stringify([token.start_ms, token.end_ms, token.text]);
          if (seen.has(id)) continue;
          seen.add(id);
        }
        pending += token.text;
      }
      // Commit complete words while retaining the last word for split tokens.
      let boundary = 0;
      for (const word of words.segment(pending)) {
        // Use Unicode word segmentation, but only emit where the editor can
        // safely insert its space separator. Keep scripts without spaces intact.
        if (
          word.isWordLike &&
          word.index > 0 &&
          !pending[word.index - 1].trim()
        ) {
          boundary = word.index;
        }
      }
      if (boundary > 0) {
        const complete = pending.slice(0, boundary);
        pending = pending.slice(boundary);
        events.final(complete);
      }
      events.interim(pending + provisional);
      if (result.finished) this.finish();
    },
    finish() {
      flush();
      provisional = '';
      events.interim('');
    }
  };
}
