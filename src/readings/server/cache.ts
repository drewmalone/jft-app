import 'server-only';
import { z } from 'zod';
import type { Reading } from '../model';

/** Process-local, bounded cache. Missing dates are cached; failed lookups are retried. */
export class ReadingCache {
  private readonly entries = new Map<
    string,
    { promise: Promise<Reading | null>; expiresAt: number }
  >();
  constructor(
    private readonly load: (date: string) => Promise<Reading | null>,
    private readonly now = () => Date.now(),
    private readonly lifetimeMs = 5 * 60_000,
    private readonly capacity = 16
  ) {}
  async get(date: string): Promise<Reading | null> {
    z.iso.date().parse(date);
    let entry = this.entries.get(date);
    if (entry && entry.expiresAt > this.now()) {
      this.entries.delete(date);
      this.entries.set(date, entry);
    } else {
      entry = { promise: Promise.resolve(null), expiresAt: Infinity };
      const current = entry;
      current.promise = Promise.resolve()
        .then(() => this.load(date))
        .then((reading) => {
          current.expiresAt = this.now() + this.lifetimeMs;
          return reading;
        })
        .catch((cause) => {
          if (this.entries.get(date) === current) this.entries.delete(date);
          throw cause;
        });
      this.entries.set(date, entry);
      while (this.entries.size > this.capacity)
        this.entries.delete(this.entries.keys().next().value!);
    }
    return structuredClone(await entry.promise);
  }
}
