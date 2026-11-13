import { useShareDraft } from './use-share-draft';
import type { DailyReading } from '../readings/model';
import { ApiRequestError } from './http-client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Share } from './model';
import { readShare, saveShare } from './api';
import { useShareHistory } from './history/use-share-history';

type Screen =
  { view: 'today' | 'past' } | { view: 'saved' | 'detail'; share: Share };
type DetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; message: string };

/** Mounted application owns the draft and async transitions across screens; never persists draft text. */
export function useShareApplication(
  daily: DailyReading,
  refreshReading: () => void
) {
  const [screen, setScreen] = useState<Screen>({ view: 'today' });
  const draft = useShareDraft(daily);
  const { text, needsReview, displayedReading, recordingChanged, canReview } =
    draft;
  const reading = displayedReading.reading;
  const [preparing, setPreparing] = useState(false);
  const {
    history,
    sessionReady,
    refresh: loadHistory,
    loadMore
  } = useShareHistory();
  const [saveError, setSaveError] = useState('');
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const mounted = useRef(false);
  const detailRequest = useRef(0);
  const [detailState, setDetailState] = useState<DetailState>({
    status: 'idle'
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function navigate(next: Screen) {
    detailRequest.current++;
    setDetailState({ status: 'idle' });
    setScreen(next);
    if (next.view === 'past' && sessionReady) void loadHistory();
  }
  async function openShare(id: string) {
    const requestId = ++detailRequest.current;
    setDetailState({ status: 'loading' });
    try {
      const share = await readShare(id);
      if (mounted.current && requestId === detailRequest.current)
        navigate({ view: 'detail', share });
    } catch {
      if (mounted.current && requestId === detailRequest.current)
        setDetailState({
          status: 'failed',
          message: 'This share could not be opened. Please try again.'
        });
    }
  }
  async function save(event?: FormEvent<HTMLFormElement>, tidy = true) {
    event?.preventDefault();
    if (savePending.current) return;
    if (!sessionReady || needsReview) {
      setPreparing(false);
      return;
    }
    if (!reading) {
      setPreparing(false);
      setSaveError(
        'The daily reading is unavailable. Your words are still here.'
      );
      return;
    }
    if (!text.trim()) {
      setPreparing(false);
      setSaveError('Write a few words before saving your share.');
      return;
    }
    savePending.current = true;
    setSaving(true);
    setPreparing(true);
    setCleanupFailed(false);
    setSaveError('');
    try {
      const share = await saveShare(text, reading.date, reading.id, tidy);
      if (!mounted.current) return;
      draft.reset();
      navigate({ view: 'saved', share });
    } catch (cause) {
      if (!mounted.current) return;
      setCleanupFailed(
        cause instanceof ApiRequestError && cause.code === 'CLEANUP_UNAVAILABLE'
      );
      if (
        cause instanceof ApiRequestError &&
        cause.code === 'READING_CHANGED'
      ) {
        draft.conflict();
        refreshReading();
      }
      setSaveError(
        `Your share could not be saved. Your words are still here. ${cause instanceof Error ? cause.message : 'Check your connection and try again.'}`
      );
    } finally {
      savePending.current = false;
      if (mounted.current) {
        setSaving(false);
        setPreparing(false);
      }
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
      setSaveError('');
    },
    screen,
    text,
    preparing,
    preparingChanged: setPreparing,
    edit: draft.edit,
    history,
    sessionReady,
    loadHistory,
    loadMore,
    saveError,
    saveOriginal: cleanupFailed
      ? () => {
          void save(undefined, false);
        }
      : undefined,
    saving,
    detailState,
    navigate,
    openShare,
    save
  };
}
