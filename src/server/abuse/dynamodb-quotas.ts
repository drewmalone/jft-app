import 'server-only';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  GetCommand
} from '@aws-sdk/lib-dynamodb';
import type { QuotaOperation } from '../../config/quotas';
import { QuotaExceeded, type QuotaBackend, type Counter } from './quotas';

/** All counters commit together; rejection consumes none. TTL only removes old windows. */
export class DynamoQuotaBackend implements QuotaBackend {
  constructor(
    private table: string,
    private client: Pick<DynamoDBDocumentClient, 'send'>
  ) {}
  async disabled(operation: QuotaOperation) {
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
      return;
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
