import 'server-only';
import {
  quotaPolicy,
  type QuotaOperation,
  type QuotaPolicy
} from '../../config/quotas';

export type Counter = {
  id: string;
  limit: number;
  expiresAt: number;
  retryAfter?: number;
};
export class QuotaExceeded extends Error {
  constructor(readonly retryAfter: number) {
    super('quota exceeded');
  }
}
export interface QuotaBackend {
  consume(counters: readonly Counter[]): Promise<void>;
  disabled(operation: QuotaOperation): Promise<boolean>;
}

/** Pure quota policy: success returns normally; denial and unavailability throw. */
export class QuotaService {
  constructor(
    private backend: QuotaBackend,
    private now = Date.now,
    private policy: QuotaPolicy = quotaPolicy
  ) {}
  async check(operation: QuotaOperation, owner: string): Promise<void> {
    if (
      (operation === 'transcription' || operation === 'cleanup') &&
      (await this.backend.disabled(operation))
    )
      throw new Error('feature disabled');
    if (!owner) throw new Error('owner required');
    const now = Math.floor(this.now() / 1000);
    await this.backend.consume(
      this.policy[operation].map((rule) => {
        const end = (Math.floor(now / rule.seconds) + 1) * rule.seconds;
        return {
          id: `${operation}:${owner}:${rule.seconds}:${Math.floor(now / rule.seconds)}`,
          limit: rule.limit,
          expiresAt: end + 86400,
          retryAfter: end - now
        };
      })
    );
  }
}
