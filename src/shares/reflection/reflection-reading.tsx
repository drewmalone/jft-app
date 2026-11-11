import type { DailyReading } from '../../readings/model';
import { readingDateLabel } from '../dates';

export function ReflectionReading({
  daily,
  loading,
  failed,
  onRetry
}: {
  daily: DailyReading;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { reading } = daily;
  return (
    <section className="reading text-center" aria-label="Today's reflection">
      {reading ? (
        <>
          <p className="eyebrow">
            {daily.sample ? 'Sample reading' : 'Just for Today'} ·{' '}
            {readingDateLabel(reading.date)}
          </p>
          <p className="mt-6 font-serif text-[27px] leading-snug sm:text-3xl">
            {reading.title}
          </p>
          <div className="divider" />
          <p className="reading-body whitespace-pre-line">{reading.body}</p>
        </>
      ) : (
        <p className="reading-body whitespace-pre-line">
          Today&apos;s reading is not available yet.
        </p>
      )}
      {loading && (
        <p role="status" className="mt-4">
          Loading your daily reading…
        </p>
      )}
      {(failed || !reading) && (
        <div className="mt-4">
          <p role="status">
            The daily reading is unavailable. Your words stay here.
          </p>
          <button
            className="secondary mt-3"
            disabled={loading}
            onClick={onRetry}
          >
            Try reading again
          </button>
        </div>
      )}
    </section>
  );
}
