'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Share } from './shares';
import { readShares, saveShare } from './storage';
import { ShareForm } from './components/share-form';
import { ShareHistory } from './components/share-history';
import { ShareDetail } from './components/share-detail';
import { ReflectionReading } from './components/reflection-reading';

type Screen =
  { view: 'today' | 'past' } | { view: 'saved' | 'detail'; share: Share };
const screenCopy = {
  today: {
    title: 'Write your share',
    description: "What's on your mind about today's reading?"
  },
  past: {
    title: 'Past shares',
    description: 'Your personal history. A little space to look back.'
  },
  saved: {
    title: 'Your share has been saved.',
    description: 'Thank you for making space for yourself today.'
  },
  detail: {
    title: 'Your share',
    description: 'A moment you made space for yourself.'
  }
};

/** Owns the local writing, confirmation, history, and full-share views. */
export function ShareApp() {
  const [screen, setScreen] = useState<Screen>({ view: 'today' });
  const { view } = screen;
  const [text, setText] = useState('');
  const [shares, setShares] = useState<Share[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);

  useEffect(() => {
    try {
      setShares(readShares(localStorage));
    } catch {
      setError(
        'Your saved shares could not be read. Check that browser storage is available, then refresh. Existing data has not been changed.'
      );
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    if (navigated.current) heading.current?.focus();
    navigated.current = true;
  }, [view]);
  function navigate(next: Screen) {
    setScreen(next);
    window.scrollTo({ top: 0 });
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const { share, shares: next } = saveShare(localStorage, text);
      setShares(next);
      setText('');
      setError('');
      navigate({ view: 'saved', share });
    } catch {
      setError(
        text.trim()
          ? 'Your share could not be saved. Your words are still here. Check browser storage or available space and try again.'
          : 'Write a few words before saving your share.'
      );
    }
  }
  const { title, description } = screenCopy[view];

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-[var(--line)] px-6 py-6 sm:px-10">
        <button
          className="brand flex items-center gap-3"
          onClick={() => navigate({ view: 'today' })}
          aria-label="Doorknob, today's reflection"
        >
          <svg
            width="30"
            height="39"
            viewBox="0 0 30 39"
            fill="none"
            aria-hidden="true"
          >
            <path d="M2 9 19 2v35L2 30Z" fill="currentColor" />
            <path d="m23 3 5 2v29l-5 2Z" fill="#C4A16C" />
            <circle cx="13" cy="20" r="1.8" fill="#E2C394" />
          </svg>
          <span>Doorknob</span>
        </button>
        <button
          className="nav-link"
          onClick={() =>
            navigate({
              view: view === 'past' || view === 'detail' ? 'today' : 'past'
            })
          }
        >
          {view === 'past' || view === 'detail'
            ? 'Today’s reflection'
            : 'Past shares'}{' '}
          <span aria-hidden="true">→</span>
        </button>
      </header>
      <main className="mx-auto max-w-xl px-6 pb-12 pt-10 sm:px-8 sm:pt-14">
        {view === 'today' && <ReflectionReading />}
        {view === 'saved' && (
          <div
            className="check mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-full text-3xl"
            aria-hidden="true"
          >
            ✓
          </div>
        )}
        <h1
          ref={heading}
          tabIndex={-1}
          className={`font-serif text-[40px] leading-[1.1] tracking-[-0.045em] outline-none sm:text-5xl ${view === 'today' ? 'mt-12' : ''} ${view === 'saved' ? 'text-center' : ''}`}
        >
          {title}
        </h1>
        <p
          className={`mt-3 text-[16px] leading-relaxed text-[var(--muted)] ${view === 'saved' ? 'text-center' : ''}`}
        >
          {description}
        </p>
        {error && (
          <p
            id="share-error"
            role="alert"
            className="error mt-6 rounded-xl border p-4 text-sm leading-relaxed"
          >
            {error}
          </p>
        )}
        {view === 'today' && (
          <ShareForm
            text={text}
            disabled={!ready}
            error={error}
            onTextChange={setText}
            onSave={save}
          />
        )}
        {view === 'past' && (
          <ShareHistory
            ready={ready}
            shares={shares}
            onWrite={() => navigate({ view: 'today' })}
            onOpen={(share) => navigate({ view: 'detail', share })}
          />
        )}
        {(screen.view === 'saved' || screen.view === 'detail') && (
          <>
            <ShareDetail share={screen.share} />
            <button
              className="primary mt-7 w-full"
              onClick={() => navigate({ view: 'today' })}
            >
              Today&apos;s reflection
            </button>
            <button
              className="secondary mt-3 w-full"
              onClick={() => navigate({ view: 'past' })}
            >
              Past shares
            </button>
          </>
        )}
        <footer className="mt-12 text-center">
          <div className="divider" />
          <p className="eyebrow">One day. One thought. One step.</p>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
            Private to this browser. Clearing site data removes saved shares.
          </p>
        </footer>
      </main>
    </div>
  );
}
