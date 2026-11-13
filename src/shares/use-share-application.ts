import { useSession } from '../session/use-session';
import { useShareDraft } from './use-share-draft';
import type { DailyReading } from '../readings/model';
import { ApiRequestError } from '../http/client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Share } from './model';
import { readShare, saveShare } from './api';
import { useShareCleanup } from './cleanup/use-share-cleanup';
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
  const cleanup = useShareCleanup(text, draft.edit);
  const session = useSession();
  const sessionReady = session.ready;
  const { history, refresh: loadHistory, loadMore } = useShareHistory();
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const submission = useRef<{ payload: string; key: string } | null>(null);
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
  useEffect(() => {
    if (screen.view === 'past' && sessionReady) void loadHistory();
  }, [screen.view, sessionReady, loadHistory]);
  function navigate(next: Screen) {
    cleanup.cancel();
    detailRequest.current++;
    setDetailState({ status: 'idle' });
    setScreen(next);
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
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending.current || !sessionReady || needsReview) return;
    if (!reading) {
      setSaveError(
        'The daily reading is unavailable. Your words are still here.'
      );
      return;
    }
    if (!text.trim()) {
      setSaveError('Write a few words before saving your share.');
      return;
    }
    savePending.current = true;
    setSaving(true);
    setSaveError('');
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
      navigate({ view: 'saved', share });
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
      setSaveError(
        `Your share could not be saved. Your words are still here. ${cause instanceof Error ? cause.message : 'Check your connection and try again.'}`
      );
    } finally {
      savePending.current = false;
      if (mounted.current) setSaving(false);
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
