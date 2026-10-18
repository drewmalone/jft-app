import type { Share } from '../shares';
import { dateLabel } from '../dates';

type ShareHistoryProps = {
  ready: boolean;
  shares: Share[];
  onWrite: () => void;
  onOpen: (share: Share) => void;
};

/** Displays saved history, loading feedback, or the first-share invitation. */
export function ShareHistory({
  ready,
  shares,
  onWrite,
  onOpen
}: ShareHistoryProps) {
  return (
    <div className="mt-9">
      {!ready ? (
        <p role="status">Loading your shares…</p>
      ) : shares.length === 0 ? (
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
