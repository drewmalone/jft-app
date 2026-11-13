'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareSession } from './api';

type SessionState =
  { status: 'preparing' | 'ready' } | { status: 'failed'; message: string };
/** Serialize cookie establishment, including Strict Mode and explicit retries; history is independent. */
export function useSession(request = prepareSession) {
  const [state, setState] = useState<SessionState>({ status: 'preparing' });
  const pending = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);
  const requestRef = useRef(request);
  const start = useCallback(() => {
    const current = (pending.current ??= Promise.resolve().then(() =>
      requestRef.current()
    ));
    return current.finally(() => {
      if (pending.current === current) pending.current = null;
    });
  }, []);
  const complete = useCallback((ready: boolean) => {
    if (mounted.current)
      setState(
        ready
          ? { status: 'ready' }
          : {
              status: 'failed',
              message:
                'Your private session could not be prepared. Your words are still here. Please try again.'
            }
      );
  }, []);
  useEffect(() => {
    mounted.current = true;
    void start().then(
      () => complete(true),
      () => complete(false)
    );
    return () => {
      mounted.current = false;
    };
  }, [start, complete]);
  const retry = useCallback(() => {
    setState({ status: 'preparing' });
    return start().then(
      () => complete(true),
      () => complete(false)
    );
  }, [start, complete]);
  return { state, ready: state.status === 'ready', retry };
}
