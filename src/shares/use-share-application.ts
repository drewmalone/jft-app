import {
  reduceApplication,
  initialApplicationState,
  type Screen
} from './application-state';
import { useSession } from '../session/use-session';
import { useShareDraft } from './use-share-draft';
import type { DailyReading } from '../readings/model';
import { ApiRequestError } from '../http/client';
import { useEffect, useRef, useReducer, type FormEvent } from 'react';
import { readShare, saveShare } from './api';
import { useShareCleanup } from './cleanup/use-share-cleanup';
import { useShareHistory } from './history/use-share-history';

/** Mounted application owns the draft and async transitions across screens; never persists draft text. */
export function useShareApplication(
  daily: DailyReading,
  refreshReading: () => void
) {
  const [state, dispatch] = useReducer(
    reduceApplication,
    initialApplicationState
  );
  const { screen, detail: detailState } = state;
  const saving = state.save.status === 'saving';
  const saveError = state.save.status === 'failed' ? state.save.message : '';
  const draft = useShareDraft(daily);
  const { text, needsReview, displayedReading, recordingChanged, canReview } =
    draft;
  const reading = displayedReading.reading;
  const cleanup = useShareCleanup(text, draft.edit);
  const session = useSession();
  const sessionReady = session.ready;
  const { history, refresh: loadHistory, loadMore } = useShareHistory();
  const savePending = useRef(false);
  const submission = useRef<{ payload: string; key: string } | null>(null);
  const mounted = useRef(false);
  const detailRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (screen.view === 'past' && sessionReady) void loadHistory();
  }, [screen.view, sessionReady, loadHistory]);
  function navigate(next: Screen) {
    cleanup.cancel();
    detailRequest.current++;
    dispatch({ type: 'navigate', screen: next });
  }
  async function openShare(id: string) {
    const requestId = ++detailRequest.current;
    dispatch({ type: 'detailStarted' });
    try {
      const share = await readShare(id);
      if (mounted.current && requestId === detailRequest.current)
        navigate({ view: 'detail', share });
    } catch {
      if (mounted.current && requestId === detailRequest.current)
        dispatch({
          type: 'detailFailed',
          message: 'This share could not be opened. Please try again.'
        });
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending.current || !sessionReady || needsReview) return;
    if (!reading) {
      dispatch({
        type: 'saveFailed',
        message: 'The daily reading is unavailable. Your words are still here.'
      });
      return;
    }
    if (!text.trim()) {
      dispatch({
        type: 'saveFailed',
        message: 'Write a few words before saving your share.'
      });
      return;
    }
    savePending.current = true;
    dispatch({ type: 'saveStarted' });
    try {
      const payload = JSON.stringify([text.trim(), reading.date, reading.id]);
      if (submission.current?.payload !== payload)
        submission.current = { payload, key: crypto.randomUUID() };
      const share = await saveShare(
        text,
        reading.date,
        reading.id,
        submission.current.key
      );
      if (!mounted.current) return;
      cleanup.cancel();
      draft.reset();
      submission.current = null;
      detailRequest.current++;
      dispatch({ type: 'saveSucceeded', share });
    } catch (cause) {
      if (!mounted.current) return;
      if (
        cause instanceof ApiRequestError &&
        cause.code === 'IDEMPOTENCY_CONFLICT'
      )
        submission.current = null;
      if (
        cause instanceof ApiRequestError &&
        cause.code === 'READING_CHANGED'
      ) {
        draft.conflict();
        refreshReading();
      }
      dispatch({
        type: 'saveFailed',
        message: `Your share could not be saved. Your words are still here. ${cause instanceof Error ? cause.message : 'Check your connection and try again.'}`
      });
    } finally {
      savePending.current = false;
    }
  }
  return {
    displayedReading,
    pinned: !!draft.pinned,
    recordingChanged,
    needsReview,
    canReview,
    reviewReading() {
      if (!daily.reading || daily.reading.id === reading?.id) return;
      draft.review();
      dispatch({ type: 'clearSaveError' });
    },
    screen,
    text,
    cleanup,
    history,
    session,
    sessionReady,
    loadHistory,
    loadMore,
    saveError,
    saving,
    detailState,
    navigate,
    openShare,
    save
  };
}
