'use client';

import { useEffect, useRef, useState } from 'react';
import { createShare, parseShares, reflection, STORAGE_KEY, type Share } from '@/lib/shares';

type View = 'today' | 'saved' | 'past' | 'detail';
const dateLabel = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export default function Home() {
  const [view, setView] = useState<View>('today');
  const [text, setText] = useState('');
  const [shares, setShares] = useState<Share[]>([]);
  const [selected, setSelected] = useState<Share | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);

  useEffect(() => {
    try { setShares(parseShares(localStorage.getItem(STORAGE_KEY))); }
    catch { setError('Your saved shares could not be read. Check that browser storage is available, then refresh. Existing data has not been changed.'); }
    finally { setReady(true); }
  }, []);
  useEffect(() => {
    if (navigated.current) heading.current?.focus();
    navigated.current = true;
  }, [view]);
  function navigate(next: View) { setView(next); window.scrollTo({ top: 0 }); }
  function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const share = createShare(text);
      // Read again so another tab's recent saves are retained. Never overwrite unreadable data.
      const next = [share, ...parseShares(localStorage.getItem(STORAGE_KEY))];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setShares(next); setSelected(share); setText(''); setError(''); navigate('saved');
    } catch {
      setError(text.trim() ? 'Your share could not be saved. Your words are still here. Check browser storage or available space and try again.' : 'Write a few words before saving your share.');
    }
  }
  const title = view === 'today' ? 'Write your share' : view === 'past' ? 'Past shares' : view === 'saved' ? 'Your share has been saved.' : 'Your share';

  return <div className="min-h-screen">
    <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-[var(--line)] px-6 py-6 sm:px-10">
      <button className="brand flex items-center gap-3" onClick={() => navigate('today')} aria-label="Doorknob, today's reflection">
        <svg width="30" height="39" viewBox="0 0 30 39" fill="none" aria-hidden="true"><path d="M2 9 19 2v35L2 30Z" fill="currentColor"/><path d="m23 3 5 2v29l-5 2Z" fill="#C4A16C"/><circle cx="13" cy="20" r="1.8" fill="#E2C394"/></svg>
        <span>Doorknob</span>
      </button>
      <button className="nav-link" onClick={() => navigate(view === 'past' || view === 'detail' ? 'today' : 'past')}>{view === 'past' || view === 'detail' ? 'Today’s reflection' : 'Past shares'} <span aria-hidden="true">→</span></button>
    </header>
    <main className="mx-auto max-w-xl px-6 pb-12 pt-10 sm:px-8 sm:pt-14">
      {view === 'today' && <section className="reading text-center" aria-label="Today's reflection">
        <p className="eyebrow">Wednesday, April 23, 2025</p>
        <p className="mt-6 font-serif text-[27px] leading-snug sm:text-3xl">{reflection.title}</p>
        <div className="divider" />
        <p className="reading-body">{reflection.body}</p>
        <p className="eyebrow mt-5">A thought for today</p>
      </section>}
      {view === 'saved' && <div className="check mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-full text-3xl" aria-hidden="true">✓</div>}
      <h1 ref={heading} tabIndex={-1} className={`font-serif text-[40px] leading-[1.1] tracking-[-0.045em] outline-none sm:text-5xl ${view === 'today' ? 'mt-12' : ''} ${view === 'saved' ? 'text-center' : ''}`}>{title}</h1>
      <p className={`mt-3 text-[16px] leading-relaxed text-[var(--muted)] ${view === 'saved' ? 'text-center' : ''}`}>
        {view === 'today' ? "What's on your mind about today's reading?" : view === 'past' ? 'Your personal history. A little space to look back.' : view === 'saved' ? 'Thank you for making space for yourself today.' : 'A moment you made space for yourself.'}
      </p>
      {error && <p role="alert" className="error mt-6 rounded-xl border p-4 text-sm leading-relaxed">{error}</p>}
      {view === 'today' && <form onSubmit={save} className="mt-7">
        <label htmlFor="thoughts" className="sr-only">Your thoughts about today's reading</label>
        <textarea id="thoughts" value={text} onChange={event => setText(event.target.value)} placeholder="Start wherever you are…" className="min-h-64 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper)] p-5 font-serif text-xl leading-relaxed outline-none transition focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)]" />
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[var(--muted)]"><svg className="mt-0.5 shrink-0" width="13" height="14" viewBox="0 0 16 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="2" y="8" width="12" height="8" rx="2"/><path d="M5 8V5a3 3 0 0 1 6 0v3"/></svg> Saved only in this browser. Your words stay on this device.</p>
        <button className="primary mt-7 w-full" disabled={!ready || !text.trim()} type="submit">Save privately <span aria-hidden="true">→</span></button>
      </form>}
      {view === 'past' && <div className="mt-9">
        {!ready ? <p role="status">Loading your shares…</p> : shares.length === 0 ? <div className="empty rounded-xl border border-[var(--line)] p-7"><p className="font-serif text-2xl">A place for your words.</p><p className="mt-3 leading-relaxed text-[var(--muted)]">Your saved shares will appear here. Start with whatever is on your mind today.</p><button className="primary mt-6 w-full" onClick={() => navigate('today')}>Write your first share</button></div> : <ul>{shares.map(share => <li key={share.id} className="border-t border-[var(--line)]"><button className="share-row flex w-full items-center gap-5 py-6 text-left" onClick={() => { setSelected(share); navigate('detail'); }}><div className="min-w-10 text-center"><span className="eyebrow">{new Date(share.createdAt).toLocaleDateString('en-US', { month: 'short' })}</span><span className="block font-serif text-3xl">{new Date(share.createdAt).getDate()}</span></div><div className="min-w-0 flex-1"><p className="font-serif text-xl leading-snug">{share.reflection.title}</p><p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">{share.text}</p><p className="mt-2 text-xs text-[var(--muted)]">{dateLabel(share.createdAt)} · {new Date(share.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p></div><span aria-hidden="true">›</span></button></li>)}</ul>}
      </div>}
      {(view === 'saved' || view === 'detail') && selected && <>
        <article className="share-card mt-8 rounded-xl border border-[var(--line)] p-6 sm:p-8">
          <p className="eyebrow">{dateLabel(selected.createdAt)}</p>
          <h2 className="mt-4 font-serif text-2xl leading-snug">{selected.reflection.title}</h2>
          <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">{selected.reflection.body}</p>
          <div className="my-6 border-t border-[var(--line)]" />
          <p className="eyebrow">Your thoughts</p>
          <p className="mt-3 whitespace-pre-wrap break-words font-serif text-xl leading-relaxed">{selected.text}</p>
        </article>
        <button className="primary mt-7 w-full" onClick={() => navigate('today')}>Today's reflection</button>
        <button className="secondary mt-3 w-full" onClick={() => navigate('past')}>Past shares</button>
      </>}
      <footer className="mt-12 text-center"><div className="divider"/><p className="eyebrow">One day. One thought. One step.</p><p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">Private to this browser. Clearing site data removes saved shares.</p></footer>
    </main>
  </div>;
}
