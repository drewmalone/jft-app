import { ReadingQuotation } from '../../readings/reading-quotation';
import type { Share } from '../model';
import { ExpandableThoughts } from './expandable-thoughts';
import { dateLabel, readingDateLabel } from '../dates';

/** Render the saved reading snapshot, not the current reading. */
export function ShareDetail({ share }: { share: Share }) {
  return (
    <section aria-label="Saved share">
      <article className="share-card mt-4 rounded-xl border border-[var(--line)] p-5 sm:p-6">
        <p className="eyebrow">
          Saved {dateLabel(share.createdAt)} ·{' '}
          {new Date(share.createdAt).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
          })}
        </p>
        <div className="mt-4">
          <h2 className="font-serif text-2xl">Your thoughts</h2>
          <ExpandableThoughts key={share.id} text={share.text} />
        </div>
        <div className="my-4 border-t border-[var(--line)]" />
        <details className="group mt-3 text-[var(--muted)]">
          <summary className="min-h-11 cursor-pointer rounded py-2 text-xs leading-relaxed marker:text-[var(--muted)]">
            <span className="font-semibold">Original reflection</span>
            <span className="ml-2">
              · {readingDateLabel(share.reflection.date)}
            </span>
            <span className="mt-1 block truncate text-sm font-medium text-[var(--navy)]">
              {share.reflection.title}
            </span>
            <span className="mt-1 line-clamp-1 text-xs group-open:hidden">
              {Array.from(share.reflection.body)
                .slice(0, 96)
                .join('')
                .trimEnd()}
              {Array.from(share.reflection.body).length > 96 ? '…' : ''}
            </span>
            <span className="mt-1 block underline underline-offset-4 group-open:hidden">
              Read original reflection
            </span>
            <span className="mt-1 hidden underline underline-offset-4 group-open:block">
              Hide original reflection
            </span>
          </summary>
          <div className="text-sm leading-relaxed">
            <ReadingQuotation reading={share.reflection} />
            <p className="mt-3 whitespace-pre-line">{share.reflection.body}</p>
          </div>
        </details>
      </article>
    </section>
  );
}
