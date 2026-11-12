import 'server-only';
import { z } from 'zod';
import { parseCatalog, type ReadingCatalog } from './catalog';
import type { CatalogLoad } from './sources';

/** One process-local catalog, single-flight refresh, and last-good data during source outages. */
export class ReadingCache {
  private catalog?: ReadingCatalog;
  private etag?: string;
  private expiresAt = 0;
  private pending?: Promise<void>;
  constructor(
    private readonly load: CatalogLoad,
    private readonly now = () => Date.now(),
    private readonly lifetimeMs = 5 * 60_000
  ) {}
  private async refresh() {
    try {
      const loaded = await this.load(this.etag);
      if ('content' in loaded) {
        const validated = parseCatalog(loaded.content);
        this.catalog = validated;
        this.etag = loaded.etag;
      } else if (!this.catalog)
        throw new Error('No reading catalog has been loaded.');
      this.expiresAt = this.now() + this.lifetimeMs;
    } catch (cause) {
      if (!this.catalog) throw cause;
      this.expiresAt = this.now() + Math.min(this.lifetimeMs, 60_000);
      console.warn(
        'Reading catalog refresh failed; retaining last valid publication.'
      );
    }
  }
  async get(date: string) {
    z.iso.date().parse(date);
    if (!this.catalog || this.now() >= this.expiresAt) {
      this.pending ??= this.refresh().finally(() => {
        this.pending = undefined;
      });
      await this.pending;
    }
    return {
      date,
      reading: structuredClone(this.catalog!.byDate.get(date) ?? null),
      sample: this.catalog!.sample
    };
  }
}
