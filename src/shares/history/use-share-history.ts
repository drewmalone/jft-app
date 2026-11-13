'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readShares, type ShareHistoryPage } from '../api';
import type { Share } from '../model';

/** Only a successfully loaded empty array means there are no saved shares. */
export type ShareHistoryState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | {
      status: 'loaded';
      shares: Share[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreError: string;
    };

/** Read history on demand after session readiness; stale responses never replace newer pages. */
export function useShareHistory() {
  const [history, setHistory] = useState<ShareHistoryState>({
    status: 'loading'
  });
  const requestId = useRef(0);
  const pageRequest = useRef<symbol | null>(null);

  const load = useCallback(async (request: Promise<ShareHistoryPage>) => {
    const current = ++requestId.current;
    pageRequest.current = null;
    setHistory({ status: 'loading' });
    try {
      const { shares, nextCursor } = await request;
      if (current === requestId.current) {
        setHistory({
          status: 'loaded',
          shares,
          nextCursor,
          loadingMore: false,
          moreError: ''
        });
      }
    } catch (cause) {
      if (current === requestId.current)
        setHistory({
          status: 'failed',
          message: `Your saved shares could not be read. ${cause instanceof Error ? cause.message : 'Check your connection and try again.'}`
        });
    }
  }, []);

  function invalidate() {
    requestId.current++;
    pageRequest.current = null;
  }

  useEffect(() => invalidate, []);
  const refresh = useCallback(() => load(readShares()), [load]);

  async function loadMore() {
    if (
      history.status !== 'loaded' ||
      !history.nextCursor ||
      pageRequest.current
    )
      return;
    const token = Symbol();
    pageRequest.current = token;
    const generation = requestId.current;
    setHistory({ ...history, loadingMore: true, moreError: '' });
    try {
      const page = await readShares(history.nextCursor);
      if (generation !== requestId.current || pageRequest.current !== token)
        return;
      setHistory((current) => {
        if (current.status !== 'loaded') return current;
        const seen = new Set(current.shares.map((share) => share.id));
        return {
          status: 'loaded',
          shares: [
            ...current.shares,
            ...page.shares.filter((share) => !seen.has(share.id))
          ],
          nextCursor: page.nextCursor,
          loadingMore: false,
          moreError: ''
        };
      });
    } catch {
      if (generation === requestId.current && pageRequest.current === token) {
        setHistory((current) =>
          current.status === 'loaded'
            ? {
                ...current,
                loadingMore: false,
                moreError: 'More shares could not be read. Try again.'
              }
            : current
        );
      }
    } finally {
      if (pageRequest.current === token) pageRequest.current = null;
    }
  }
  return { history, refresh, loadMore };
}
