import 'server-only';
import { z } from 'zod';
import type { Reading } from '../model';
import { parseCatalog, type ReadingCatalog } from './catalog';
import type { CatalogLoad } from './sources';

/** One process-local catalog, single-flight refresh, and last-good data during source outages. */
export class ReadingCache {
  private catalog?: ReadingCatalog;
  private etag?: string;
  private expiresAt = 0;
  private pending?: Promise<void>;
  private retryAt = 0;
  private failures = 0;
  private initialFailure?: unknown;
  private readonly requireComplete: boolean;
  private readonly now: () => number;
  private readonly lifetimeMs: number;
  private readonly sample: boolean;
  constructor(
    private readonly load: CatalogLoad,
    {
      now = () => Date.now(),
      lifetimeMs = 5 * 60_000,
      sample = false,
      requireComplete = false
    }: {
      now?: () => number;
      lifetimeMs?: number;
      sample?: boolean;
      requireComplete?: boolean;
    } = {}
  ) {
    this.now = now;
    this.lifetimeMs = lifetimeMs;
    this.sample = sample;
    this.requireComplete = requireComplete;
  }
  private async refresh() {
    try {
      const loaded = await this.load(this.etag);
      if ('content' in loaded) {
        const validated = parseCatalog(loaded.content, {
          requireComplete: this.requireComplete
        });
        this.catalog = validated;
        this.etag = loaded.etag;
      } else if (!this.catalog)
        throw new Error('No reading catalog has been loaded.');
      this.expiresAt = this.now() + this.lifetimeMs;
      this.failures = 0;
      this.initialFailure = undefined;
      this.retryAt = 0;
    } catch (cause) {
      if (!this.catalog) {
        this.initialFailure = cause;
        this.retryAt =
          this.now() +
          Math.min(1000 * 2 ** Math.min(this.failures++, 5), 30_000);
        throw cause;
      }
      this.expiresAt = this.now() + Math.min(this.lifetimeMs, 60_000);
      console.warn(
        'Reading catalog refresh failed; retaining last valid publication.'
      );
    }
  }
  async get(date: string) {
    z.iso.date().parse(date);
    if (!this.catalog && this.now() < this.retryAt) throw this.initialFailure;
    if (!this.catalog || this.now() >= this.expiresAt) {
      this.pending ??= this.refresh().finally(() => {
        this.pending = undefined;
      });
      await this.pending;
    }
    const entry = this.catalog!.byDay.get(date.slice(5));
    let reading: Reading | null = null;
    if (entry) {
      const { revision, ...text } = entry;
      reading = { ...text, date, id: `jft-${date}-${revision}` };
    }
    return {
      date,
      reading,
      sample: this.sample
    };
  }
}
