import { reflection } from '../shares';

/** Displays the fixed reading for this milestone. */
export function ReflectionReading() {
  return (
    <section className="reading text-center" aria-label="Today's reflection">
      <p className="eyebrow">Wednesday, April 23, 2025</p>
      <p className="mt-6 font-serif text-[27px] leading-snug sm:text-3xl">
        {reflection.title}
      </p>
      <div className="divider" />
      <p className="reading-body">{reflection.body}</p>
      <p className="eyebrow mt-5">A thought for today</p>
    </section>
  );
}
