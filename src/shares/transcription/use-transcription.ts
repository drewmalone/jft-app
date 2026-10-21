import { useEffect, useRef, useState } from 'react';
import { createBrowserSpeech } from './browser-speech';
import { appendTranscript } from './append-transcript';
import type { TranscriptionEngine, TranscriptionState } from './types';

/** Own one engine session, discard stale callbacks, and commit only final segments to the draft. */
export function useTranscription(
  text: string,
  onTextChange: (text: string) => void
) {
  const [state, setState] = useState<TranscriptionState>('unsupported');
  const [interim, setInterim] = useState('');
  const [message, setMessage] = useState('');
  const engine = useRef<TranscriptionEngine | null>(null);
  const generation = useRef(0);
  const current = useRef({ text, onTextChange });
  useEffect(() => {
    current.current = { text, onTextChange };
  }, [text, onTextChange]);
  useEffect(() => {
    // Browser capability is read after hydration so SSR markup stays consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(createBrowserSpeech().available() ? 'idle' : 'unsupported');
    return () => {
      // This is a session counter, not a DOM ref; invalidate the latest session.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);
  const active =
    state === 'starting' || state === 'listening' || state === 'stopping';
  function stop() {
    if (!engine.current) return;
    setState('stopping');
    engine.current.stop();
  }
  function start() {
    if (engine.current) return;
    const next = createBrowserSpeech();
    if (!next.available()) {
      setState('unsupported');
      return;
    }
    engine.current = next;
    const session = ++generation.current;
    let first = true;
    let accepting = true;
    const live = () => generation.current === session;
    const finish = (failed: boolean, notice: string) => {
      if (!live()) return;
      generation.current++;
      next.dispose();
      engine.current = null;
      setInterim('');
      setState(failed ? 'error' : 'idle');
      setMessage(notice);
    };
    setMessage('');
    setInterim('');
    setState('starting');
    next.start({
      listening: () => {
        if (live()) setState('listening');
      },
      interim: (value) => {
        if (live() && accepting) setInterim(value);
      },
      final: (value) => {
        if (!live() || !accepting || !value.trim()) return;
        const result = appendTranscript(current.current.text, value, first);
        first = false;
        current.current.text = result.text;
        current.current.onTextChange(result.text);
        if (result.full) {
          accepting = false;
          finish(
            false,
            'Your share has reached the 10,000 character limit. Review or shorten your words before adding more.'
          );
        }
      },
      error: (notice) => finish(true, notice),
      ended: () =>
        finish(
          false,
          'Microphone stopped. Review your words or record more when you’re ready.'
        )
    });
  }
  return { state, interim, message, active, start, stop };
}
