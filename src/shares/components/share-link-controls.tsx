'use client';

import { useEffect, useRef, useState } from 'react';
import { generateShareLink } from '../api';

type Link = { url: string; expiresAt: number };

/** Explicit sharing controls. Links stay in component memory; no automatic generation or logging. */
export function ShareLinkControls({ id }: { id: string }) {
  const [link, setLink] = useState<Link | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (link) heading.current?.focus();
  }, [link]);

  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    setStatus('');
    try {
      const created = await generateShareLink(id);
      setLink({
        ...created,
        url: new URL(created.url, window.location.origin).href
      });
    } catch {
      setError(
        'A sharing link could not be created. Please try again. Your saved share is still private unless you have already shared a link.'
      );
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }
  function selectLink() {
    field.current?.focus();
    field.current?.select();
  }
  async function copy() {
    if (!link) return;
    setError('');
    setStatus('');
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link.url);
      setStatus('Link copied.');
    } catch {
      selectLink();
      setError(
        'Automatic copying is unavailable. Select and copy the link above, then paste it into your message.'
      );
    }
  }
  async function send() {
    if (!link) return;
    setError('');
    setStatus('');
    if (!navigator.share) {
      selectLink();
      setStatus(
        'Device sharing is unavailable. Use Copy link or copy the selected link into your message.'
      );
      return;
    }
    try {
      await navigator.share({
        title: 'A shared reflection · Doorknob',
        url: link.url
      });
      setStatus('Sharing interface closed. Doorknob cannot confirm delivery.');
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        setStatus('Sharing canceled. You can still copy the link.');
      } else {
        setError(
          'Device sharing could not open. Use Copy link or copy the link above.'
        );
      }
    }
  }
  return (
    <section aria-label="Share this reflection" className="mt-7">
      {!link ? (
        <button
          className="secondary w-full"
          disabled={pending}
          onClick={() => void generate()}
        >
          {pending ? 'Creating sharing link…' : 'Share with another alcoholic'}
        </button>
      ) : (
        <div className="share-card rounded-xl border border-[var(--line)] p-6">
          <h2 ref={heading} tabIndex={-1} className="font-serif text-2xl">
            Share with another alcoholic
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Anyone with this link can read your share until it expires. They
            don&apos;t need a Doorknob account.
          </p>
          <p className="mt-3 text-sm leading-relaxed">
            Recipients can forward, copy, or save it. This link cannot be
            revoked immediately.
          </p>
          <p className="mt-3 text-sm">
            Expires {new Date(link.expiresAt * 1000).toLocaleString()}.
          </p>
          <label className="mt-4 block text-sm" htmlFor={`share-link-${id}`}>
            Sharing link
          </label>
          <input
            ref={field}
            id={`share-link-${id}`}
            className="mt-2 min-h-12 w-full rounded border border-[var(--line)] p-3 text-sm"
            readOnly
            value={link.url}
            onFocus={(event) => event.target.select()}
          />
          <button className="primary mt-4 w-full" onClick={() => void copy()}>
            Copy link
          </button>
          <button className="secondary mt-3 w-full" onClick={() => void send()}>
            Send share
          </button>
        </div>
      )}
      {pending && (
        <p role="status" className="mt-3">
          Creating your sharing link…
        </p>
      )}
      {error && (
        <p role="alert" className="error mt-4 rounded-xl border p-4 text-sm">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="mt-4 text-sm">
          {status}
        </p>
      )}
    </section>
  );
}
