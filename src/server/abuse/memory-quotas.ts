import 'server-only';
import { QuotaExceeded, type QuotaBackend, type Counter } from './quotas';

/** Explicit local-development adapter. Never selected for a DynamoDB deployment. */
export class MemoryQuotaBackend implements QuotaBackend {
  private counts = new Map<string, number>();
  async disabled() {
    return false;
  }
  async consume(counters: readonly Counter[]) {
    const blocked = counters.filter(
      (c) => (this.counts.get(c.id) ?? 0) >= c.limit
    );
    if (blocked.length)
      throw new QuotaExceeded(
        Math.max(...blocked.map((c) => c.retryAfter ?? 60))
      );
    for (const c of counters)
      this.counts.set(c.id, (this.counts.get(c.id) ?? 0) + 1);
    return;
  }
}
