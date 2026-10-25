import { useEffect, useRef, useState } from 'react';
import { cleanDraft } from './api';

type CleanupState =
  | { status: 'idle' | 'pending' | 'failed' }
  | { status: 'applied'; original: string; cleaned: string };

/** Parent-owned, reversible draft cleanup. Edits/navigation cancel pending work; stale responses never overwrite newer words. */
export function useShareCleanup(
  text: string,
  onTextChange: (text: string) => void,
  request = cleanDraft
) {
  const [state, setState] = useState<CleanupState>({ status: 'idle' });
  const pending = useRef<AbortController | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ text, onTextChange });
  useEffect(() => {
    current.current = { text, onTextChange };
  }, [text, onTextChange]);
  useEffect(
    () => () => {
      clearTimeout(timeout.current);
      pending.current?.abort();
      pending.current = null;
    },
    []
  );
  function cancel() {
    if (!pending.current) return;
    clearTimeout(timeout.current);
    pending.current.abort();
    pending.current = null;
    setState({ status: 'idle' });
  }
  function edit(value: string) {
    cancel();
    setState({ status: 'idle' });
    current.current.text = value;
    current.current.onTextChange(value);
  }
  async function run(source: string) {
    cancel();
    if (!source.trim()) return;
    const controller = new AbortController();
    pending.current = controller;
    setState({ status: 'pending' });
    const timer = setTimeout(() => {
      controller.abort();
      if (pending.current === controller) {
        pending.current = null;
        setState({ status: 'failed' });
      }
    }, 30_000);
    timeout.current = timer;
    try {
      const cleaned = await request(source, controller.signal);
      if (pending.current !== controller || current.current.text !== source)
        return;
      current.current.text = cleaned;
      current.current.onTextChange(cleaned);
      setState(
        cleaned === source
          ? { status: 'idle' }
          : { status: 'applied', original: source, cleaned }
      );
    } catch {
      if (pending.current === controller) setState({ status: 'failed' });
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) pending.current = null;
    }
  }
  function undo() {
    if (state.status !== 'applied' || current.current.text !== state.cleaned)
      return;
    edit(state.original);
  }
  return {
    state,
    pending: state.status === 'pending',
    isPending: () => pending.current !== null,
    run,
    cancel,
    edit,
    undo
  };
}

export type ShareCleanup = ReturnType<typeof useShareCleanup>;
