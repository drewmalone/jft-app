'use client';

import { useEffect, useRef, useState } from 'react';
import { readShares } from './api';
import type { Share } from './model';
import type { ShareHistoryState } from './components/share-history';

/**
 * Owns history requests and the initial session bootstrap independently of the draft.
 * @returns History, initial-request readiness, and a fresh-read callback. Refreshes
 * ignore stale results; failures become display state. Only initialization blocks saving.
 */
export function useShareHistory() {
  const [history, setHistory] = useState<ShareHistoryState>({
    status: 'loading'
  });
  const [initializing, setInitializing] = useState(true);
  const requestId = useRef(0);
  const initialRequest = useRef<Promise<Share[]> | null>(null);

  async function load(request: Promise<Share[]>) {
    const current = ++requestId.current;
    setHistory({ status: 'loading' });
    try {
      const shares = await request;
      if (current === requestId.current)
        setHistory({ status: 'loaded', shares });
    } catch (cause) {
      if (current === requestId.current)
        setHistory({
          status: 'failed',
          message: `Your saved shares could not be read. ${cause instanceof Error ? cause.message : 'Check your connection and try again.'}`
        });
    } finally {
      if (current === requestId.current) setInitializing(false);
    }
  }

  function invalidate() {
    requestId.current++;
  }

  useEffect(() => {
    // Reuse only the bootstrap read across Strict Mode effects to issue one cookie.
    initialRequest.current ??= readShares();
    void load(initialRequest.current);
    return invalidate;
  }, []);

  return { history, initializing, refresh: () => load(readShares()) };
}
