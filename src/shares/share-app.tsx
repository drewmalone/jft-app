'use client';

import { useDailyReading } from '../readings/use-daily-reading';
import type { DailyReading } from '../readings/model';
import { useEffect, useRef } from 'react';
import { useShareApplication } from './use-share-application';
import { ShareForm } from './composer/share-form';
import { ShareHistory } from './history/share-history';
import { SavedShareScreen } from './detail/saved-share-screen';
import { ReflectionReading } from './reflection/reflection-reading';
import { AppHeader } from '../components/app-header';
import { AppFooter } from '../components/app-footer';

const screenCopy = {
  today: {
    title: 'Record your share',
    description: 'Speak from your own experience'
  },
  past: {
    title: 'Past shares',
    description: ''
  },
  saved: {
    title: 'Your share is saved.',
    description: ''
  },
  detail: {
    title: 'Your share',
    description: ''
  }
};

/** Drafts live only in this mounted app; a fresh page starts a fresh share. */
export function ShareApp({ initialReading }: { initialReading: DailyReading }) {
  const reading = useDailyReading(initialReading);
  const {
    displayedReading,
    pinned,
    recordingChanged,
    needsReview,
    canReview,
    reviewReading,
    screen,
    text,
    preparing,
    preparingChanged,
    edit,
    history,
    sessionReady,
    loadHistory,
    loadMore,
    saveError,
    saveOriginal,
    saving,
    detailState,
    navigate,
    openShare,
    save
  } = useShareApplication(reading.daily, reading.retry);
  const { view } = screen;
  const main = useRef<HTMLElement>(null);
  const preparingHeading = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);
  useEffect(() => {
    if (navigated.current) {
      const error =
        !preparing && saveError
          ? main.current?.querySelector<HTMLElement>('[data-save-error]')
          : null;
      if (error) {
        error.focus({ preventScroll: true });
        error.scrollIntoView({ block: 'center' });
      } else {
        (preparing ? preparingHeading : heading).current?.focus();
        window.scrollTo({ top: 0 });
      }
    }
    navigated.current = true;
  }, [screen, preparing, saveError]);
  const { title, description } = screenCopy[view];
  const navigationView =
    view === 'past' || view === 'detail' ? 'today' : 'past';

  return (
    <div className="min-h-screen">
      <AppHeader
        disabled={preparing}
        onHome={() => navigate({ view: 'today' })}
        onNavigate={() => navigate({ view: navigationView })}
        navigationLabel={
          navigationView === 'today' ? 'Today’s reflection' : 'Past shares'
        }
      />
      <main
        ref={main}
        className="mx-auto max-w-xl px-6 pb-12 pt-8 sm:px-8 sm:pt-14"
      >
        {preparing && (
          <section aria-busy="true" className="py-12 text-center">
            <span
              aria-hidden="true"
              className="mx-auto mb-6 block h-8 w-8 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--navy)] motion-reduce:animate-none"
            />
            <h1
              ref={preparingHeading}
              tabIndex={-1}
              className="font-serif text-3xl outline-none"
            >
              Preparing your share…
            </h1>
            <p role="status" className="mt-4 text-sm text-[var(--muted)]">
              Finishing and saving your words.
            </p>
          </section>
        )}
        <div hidden={preparing}>
          {view === 'today' && (
            <ReflectionReading
              daily={displayedReading}
              loading={!pinned && reading.loading}
              failed={!pinned && reading.failed}
              onRetry={reading.retry}
            />
          )}
          {view === 'saved' && (
            <div
              className="check mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full text-lg"
              aria-hidden="true"
            >
              ✓
            </div>
          )}
          <h1
            ref={heading}
            tabIndex={-1}
            className={`font-serif leading-[1.1] tracking-[-0.035em] outline-none ${view === 'today' ? 'text-center text-[36px] sm:text-5xl' : view === 'saved' ? 'text-center text-2xl sm:text-3xl' : 'text-[36px] sm:text-5xl'} ${view === 'today' ? 'mt-8 sm:mt-12' : ''}`}
          >
            {title}
          </h1>
          {description && (
            <p
              className={`mt-3 text-[16px] leading-relaxed text-[var(--muted)] ${view === 'saved' || view === 'today' ? 'text-center' : ''}`}
            >
              {description}
            </p>
          )}
          {view === 'past' && history.status === 'failed' && (
            <p
              role="alert"
              className="error mt-6 rounded-xl border p-4 text-sm leading-relaxed"
            >
              {history.message}
            </p>
          )}
          {view === 'today' &&
            !sessionReady &&
            (history.status === 'failed' ? (
              <div className="mt-6">
                <p role="alert">
                  Your private session could not be prepared. Your words are
                  still here. {history.message}
                </p>
                <button
                  className="secondary mt-4 w-full"
                  onClick={() => void loadHistory()}
                >
                  Try again
                </button>
              </div>
            ) : (
              <p role="status" className="mt-6">
                Preparing your private session…
              </p>
            ))}
          {view === 'today' && needsReview && (
            <div className="mt-6">
              <p>
                Your draft still uses its original reading. Review the current
                reading before saving again.
              </p>
              <button
                className="secondary mt-3"
                disabled={!canReview || reading.loading}
                onClick={reviewReading}
              >
                Review current reading
              </button>
              {!canReview && (
                <button className="secondary mt-3" onClick={reading.retry}>
                  Try reading again
                </button>
              )}
            </div>
          )}
          {view === 'today' && (
            <ShareForm
              text={text}
              sessionReady={sessionReady}
              readingReady={
                !!displayedReading.reading &&
                (pinned || !reading.loading) &&
                !needsReview
              }
              onRecordingChange={recordingChanged}
              onPreparingChange={preparingChanged}
              saving={saving}
              error={saveError}
              onSaveOriginal={saveOriginal}
              onTextChange={edit}
              onSave={save}
            />
          )}
          {view === 'past' && (
            <ShareHistory
              history={history}
              onLoadMore={() => void loadMore()}
              onWrite={() => navigate({ view: 'today' })}
              onOpen={(share) => {
                if (detailState.status !== 'loading') void openShare(share.id);
              }}
            />
          )}
          {view === 'past' && detailState.status === 'loading' && (
            <p role="status">Opening your share…</p>
          )}
          {view === 'past' && detailState.status === 'failed' && (
            <p role="alert" className="error mt-6 rounded-xl border p-4">
              {detailState.message}
            </p>
          )}
          {view === 'past' && history.status === 'failed' && (
            <button
              className="secondary mt-4 w-full"
              onClick={() => void loadHistory()}
            >
              Try again
            </button>
          )}
          {(screen.view === 'saved' || screen.view === 'detail') && (
            <SavedShareScreen
              share={screen.share}
              onWrite={() => navigate({ view: 'today' })}
              onHistory={() => navigate({ view: 'past' })}
            />
          )}
          {view !== 'saved' && view !== 'detail' && <AppFooter />}
        </div>
      </main>
    </div>
  );
}
