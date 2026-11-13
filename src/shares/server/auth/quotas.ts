import 'server-only';
import { securityMetric } from './security-metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  GetCommand
} from '@aws-sdk/lib-dynamodb';
import { QuotaHttpError } from './quota-error';
import { error } from '../http/errors';

export type Operation = 'transcription' | 'cleanup' | 'create' | 'private';
type Rule = { seconds: number; limit: number };
export const quotaPolicy: Record<Operation, readonly Rule[]> = {
  transcription: [
    { seconds: 600, limit: 3 },
    { seconds: 86400, limit: 15 }
  ],
  cleanup: [
    { seconds: 600, limit: 5 },
    { seconds: 86400, limit: 30 }
  ],
  create: [
    { seconds: 3600, limit: 10 },
    { seconds: 86400, limit: 50 }
  ],
  private: [{ seconds: 60, limit: 120 }]
};
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
  consume(counters: readonly Counter[]): Promise<boolean>;
  disabled(operation: Operation): Promise<boolean>;
}
/** All counters commit together; rejection consumes none. TTL only removes old windows. */
export class DynamoQuotaBackend implements QuotaBackend {
  constructor(
    private table: string,
    private client: Pick<DynamoDBDocumentClient, 'send'>
  ) {}
  async disabled(operation: Operation) {
    const { Item } = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { id: `control:${operation}` },
        ConsistentRead: true
      })
    );
    return Item?.disabled === true;
  }
  async consume(counters: readonly Counter[]) {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: counters.map((c) => ({
            Update: {
              TableName: this.table,
              Key: { id: c.id },
              UpdateExpression: 'SET expiresAt = :expiry ADD #count :one',
              ConditionExpression:
                'attribute_not_exists(#count) OR #count < :limit',
              ExpressionAttributeNames: { '#count': 'count' },
              ExpressionAttributeValues: {
                ':expiry': c.expiresAt,
                ':one': 1,
                ':limit': c.limit
              }
            }
          }))
        })
      );
      return true;
    } catch (cause) {
      // Contention/backend errors fail closed as unavailable; only a proven quota rejection is 429.
      if (
        cause instanceof Error &&
        cause.name === 'TransactionCanceledException' &&
        'CancellationReasons' in cause &&
        Array.isArray(cause.CancellationReasons) &&
        cause.CancellationReasons.some(
          (r: { Code?: string }) => r.Code === 'ConditionalCheckFailed'
        )
      ) {
        const reasons = cause.CancellationReasons;
        const blocked = counters.filter(
          (_, i) => reasons[i]?.Code === 'ConditionalCheckFailed'
        );
        throw new QuotaExceeded(
          Math.max(...blocked.map((c) => c.retryAfter ?? 60))
        );
      }
      throw cause;
    }
  }
}
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
    return true;
  }
}
export class QuotaService {
  constructor(
    private backend: QuotaBackend,
    private now = Date.now,
    private env: Readonly<Record<string, string | undefined>> = process.env
  ) {}
  async check(operation: Operation, owner = ''): Promise<number> {
    if (
      (operation === 'transcription' || operation === 'cleanup') &&
      (this.env[`${operation.toUpperCase()}_DISABLED`] === 'true' ||
        (await this.backend.disabled(operation)))
    )
      throw new Error('feature disabled');
    const now = Math.floor(this.now() / 1000);
    const rules = quotaPolicy[operation];
    if (!owner) throw new Error('owner required');
    const counters = rules.map((rule) => {
      const override =
        this.env[`QUOTA_${operation.toUpperCase()}_OWNER_${rule.seconds}`];
      const limit = override === undefined ? rule.limit : Number(override);
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error('invalid quota configuration');
      const end = (Math.floor(now / rule.seconds) + 1) * rule.seconds;
      return {
        id: `${operation}:${owner}:${rule.seconds}:${Math.floor(now / rule.seconds)}`,
        limit,
        expiresAt: end + 86400,
        retryAfter: end - now
      };
    });
    try {
      return (await this.backend.consume(counters))
        ? 0
        : Math.max(...counters.map((c) => c.retryAfter));
    } catch (cause) {
      if (cause instanceof QuotaExceeded) {
        return cause.retryAfter;
      }
      throw cause;
    }
  }
}
let service: QuotaService | undefined;
function configuredService() {
  if (service) return service;
  const table = process.env.QUOTA_TABLE_NAME;
  if (table)
    return (service = new QuotaService(
      new DynamoQuotaBackend(
        table,
        DynamoDBDocumentClient.from(
          new DynamoDBClient({
            region: process.env.DYNAMODB_REGION,
            maxAttempts: 2,
            requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 }
          })
        )
      )
    ));
  if (
    (process.env.SHARE_PERSISTENCE ?? 'memory') === 'memory' &&
    (process.env.NODE_ENV !== 'production' ||
      process.env.QUOTA_LOCAL_ONLY === 'true')
  )
    return (service = new QuotaService(new MemoryQuotaBackend()));
  throw new Error('quota backend required');
}
/** Private reads fail open on backend failure, but an actual quota denial still returns 429. */
export async function enforceQuota(operation: Operation, owner?: string) {
  let retry: number;
  try {
    retry = await configuredService().check(operation, owner);
  } catch {
    securityMetric(operation, 'unavailable');
    if (operation === 'private') return;
    throw new QuotaHttpError(503, {
      res: error(
        operation === 'transcription'
          ? 'TRANSCRIPTION_UNAVAILABLE'
          : operation === 'cleanup'
            ? 'CLEANUP_UNAVAILABLE'
            : 'INTERNAL_ERROR'
      )
    });
  }
  securityMetric(operation, retry ? 'limited' : 'allowed');
  if (retry)
    throw new QuotaHttpError(429, {
      res: error('RATE_LIMITED', { 'Retry-After': String(retry) })
    });
}
