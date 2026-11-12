import type { Reading } from './model';

/** Quotation and attribution are optional only for older saved snapshots. */
export function ReadingQuotation({ reading }: { reading: Reading }) {
  if (!reading.quote && !reading.source) return null;
  return (
    <blockquote className="my-5 whitespace-pre-line text-base leading-relaxed">
      {reading.quote && <p>{reading.quote}</p>}
      {reading.source && (
        <footer className="mt-2 text-sm text-[var(--muted)]">
          <cite className="not-italic">{reading.source}</cite>
        </footer>
      )}
    </blockquote>
  );
}
