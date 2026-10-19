'use client';

import { useEffect, useRef, useState } from 'react';

/** Opens device sharing immediately; falls back to clipboard, then a selectable link. */
export function ShareButton({ url }: { url: string }) {
  const [pending, setPending] = useState(false);
  const [manual, setManual] = useState(false);
  const [status, setStatus] = useState('');
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (manual) {
      input.current?.focus();
      input.current?.select();
    }
  }, [manual]);
  async function share() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setStatus('');
    setManual(false);
    const link = new URL(url, window.location.origin).href;
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'A shared reflection · Doorknob',
            url: link
          });
          return;
        } catch (cause) {
          if (cause instanceof Error && cause.name === 'AbortError') return;
        }
      }
      try {
        if (!navigator.clipboard?.writeText)
          throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(link);
        setStatus('Link copied.');
      } catch {
        setManual(true);
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="relative mt-6">
      <button
        ref={button}
        type="button"
        aria-label="Share with fellow alcoholic"
        title="Share with fellow alcoholic"
        disabled={pending}
        onClick={() => void share()}
        className="secondary w-full"
      >
        <svg
          className="shrink-0"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="m8.7 10.4 6.6-3.8m-6.6 7 6.6 3.8" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="5" r="3" />
          <circle cx="18" cy="19" r="3" />
        </svg>
        <span>Share with fellow alcoholic</span>
      </button>
      {status && (
        <p role="status" className="mt-2 text-sm">
          {status}
        </p>
      )}
      {manual && (
        <div className="share-card absolute right-0 top-full z-10 w-64 rounded-xl border border-[var(--line)] p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <label htmlFor="manual-share-link" className="text-sm">
              Copy link
            </label>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                setManual(false);
                button.current?.focus();
              }}
              className="flex h-8 w-8 items-center justify-center"
            >
              ×
            </button>
          </div>
          <input
            ref={input}
            id="manual-share-link"
            aria-label="Sharing link"
            className="mt-2 min-h-11 w-full rounded border border-[var(--line)] p-2 text-sm"
            value={
              typeof window === 'undefined'
                ? url
                : new URL(url, window.location.origin).href
            }
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </div>
      )}
    </div>
  );
}
