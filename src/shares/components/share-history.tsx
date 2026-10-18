import type { Share } from '../shares';
import { dateLabel } from '../dates';

/** Keeps unreadable history distinct from a successfully loaded, empty list. */
export type ShareHistoryState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'loaded'; shares: Share[] };

type ShareHistoryProps = {
  history: ShareHistoryState;
  onWrite: () => void;
  onOpen: (share: Share) => void;
};

/** Displays saved history, loading feedback, or the first-share invitation. */
export function ShareHistory({ history, onWrite, onOpen }: ShareHistoryProps) {
  if (history.status === 'loading')
    return <p role="status">Loading your shares…</p>;
  if (history.status === 'failed') {
    // The parent displays the storage error above the view.
    return (
      <button className="secondary mt-7 w-full" onClick={onWrite}>
        Today&apos;s reflection
      </button>
    );
  }
  const { shares } = history;
  return (
    <div className="mt-9">
      {shares.length === 0 ? (
        <div className="empty rounded-xl border border-[var(--line)] p-7">
          <p className="font-serif text-2xl">A place for your words.</p>
          <p className="mt-3 leading-relaxed text-[var(--muted)]">
            Your saved shares will appear here. Start with whatever is on your
            mind today.
          </p>
          <button className="primary mt-6 w-full" onClick={onWrite}>
            Write your first share
          </button>
        </div>
      ) : (
        <ul>
          {shares.map((share) => (
            <li key={share.id} className="border-t border-[var(--line)]">
              <button
                className="share-row flex w-full items-center gap-5 py-6 text-left"
                onClick={() => {
                  onOpen(share);
                }}
              >
                <div className="min-w-10 text-center">
                  <span className="eyebrow">
                    {new Date(share.createdAt).toLocaleDateString('en-US', {
                      month: 'short'
                    })}
                  </span>
                  <span className="block font-serif text-3xl">
                    {new Date(share.createdAt).getDate()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-xl leading-snug">
                    {share.reflection.title}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">
                    {share.text}
                  </p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {dateLabel(share.createdAt)} ·{' '}
                    {new Date(share.createdAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
