import type { Share } from '../model';
import { ExpandableThoughts } from './expandable-thoughts';
import { ShareButton } from './share-button';
import { dateLabel, readingDateLabel } from '../dates';

/** Render the saved reading snapshot, not the current reading. */
export function ShareDetail({ share }: { share: Share }) {
  return (
    <section aria-label="Saved share">
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[#faf8f1] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-xl px-6 sm:px-8">
          <ShareButton url={share.shareUrl} />
        </div>
      </div>
      <article className="share-card mt-8 rounded-xl border border-[var(--line)] p-6 sm:p-8">
        <p className="eyebrow">
          Saved {dateLabel(share.createdAt)} ·{' '}
          {new Date(share.createdAt).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
          })}
        </p>
        <p className="mt-4 text-xs leading-relaxed text-[var(--muted)]">
          Sample reading · {readingDateLabel(share.reflection.date)}
        </p>
        <h2 className="mt-2 font-serif text-2xl leading-snug">
          {share.reflection.title}
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
          {share.reflection.body}
        </p>
        <div className="my-6 border-t border-[var(--line)]" />
        <h2 className="font-serif text-2xl">Your thoughts</h2>
        <ExpandableThoughts key={share.id} text={share.text} />
      </article>
    </section>
  );
}
