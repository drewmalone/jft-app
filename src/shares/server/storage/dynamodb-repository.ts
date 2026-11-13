import { requestLimits } from '../../../config/request-limits';
import {
  submissionId,
  submissionRecordSchema,
  SubmissionConflict,
  type Submission
} from './submission';
import type { Reflection } from '../../model';
import 'server-only';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import {
  createStoredShare,
  storedShareSchema,
  type StoredShare
} from './create-stored-share';
import {
  historyOptionsSchema,
  decodeHistoryCursor,
  encodeHistoryCursor,
  type HistoryOptions,
  type HistoryPage
} from './history-page';
import type { ShareRepository } from './repository';

export const OWNER_INDEX_NAME = 'owner-created-at';

export class DynamoDbShareRepository implements ShareRepository {
  constructor(
    private readonly tableName: string,
    private readonly client: Pick<DynamoDBDocumentClient, 'send'>
  ) {}

  static forRegion(tableName: string, region: string) {
    const client = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region,
        maxAttempts: 2,
        requestHandler: { connectionTimeout: 1500, requestTimeout: 5000 }
      })
    );
    return new DynamoDbShareRepository(tableName, client);
  }

  async create(
    ownerId: string,
    text: string,
    reading: Reflection,
    submission?: Submission
  ): Promise<StoredShare> {
    const share = createStoredShare(ownerId, text, reading);
    if (submission) {
      try {
        await this.client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: this.tableName,
                  Item: share,
                  ConditionExpression: 'attribute_not_exists(id)'
                }
              },
              {
                Put: {
                  TableName: this.tableName,
                  Item: {
                    id: submissionId(ownerId, submission),
                    requestHash: submission.requestHash,
                    shareId: share.id
                  },
                  ConditionExpression: 'attribute_not_exists(id)'
                }
              }
            ]
          }),
          this.deadline()
        );
      } catch (cause) {
        if (
          cause instanceof Error &&
          cause.name === 'TransactionCanceledException'
        ) {
          const previous = await this.findBySubmission(ownerId, submission);
          if (previous) return previous;
        }
        throw cause;
      }
    } else {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: share,
          ConditionExpression: 'attribute_not_exists(id)'
        }),
        this.deadline()
      );
    }
    return share;
  }

  private deadline() {
    return { abortSignal: AbortSignal.timeout(requestLimits.storageMs) };
  }

  async findBySubmission(
    ownerId: string,
    submission: Submission
  ): Promise<StoredShare | null> {
    const { Item } = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id: submissionId(ownerId, submission) },
        ConsistentRead: true
      }),
      this.deadline()
    );
    if (!Item) return null;
    const marker = submissionRecordSchema.parse(Item);
    if (marker.requestHash !== submission.requestHash)
      throw new SubmissionConflict();
    const share = await this.findByOwner(marker.shareId, ownerId);
    if (!share) throw new Error('Invalid submission record');
    return share;
  }

  async findById(id: string): Promise<StoredShare | null> {
    if (!z.uuid({ version: 'v4' }).safeParse(id).success) return null;

    const { Item } = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id },
        ConsistentRead: true
      }),
      this.deadline()
    );
    if (!Item) return null;
    const share = storedShareSchema.parse(Item);
    return share;
  }

  async findByOwner(id: string, ownerId: string): Promise<StoredShare | null> {
    const share = await this.findById(id);
    // A share ID identifies the record; private access still requires the owning session.
    return share?.ownerId === ownerId ? share : null;
  }

  async listByOwner(
    ownerId: string,
    options: HistoryOptions = {}
  ): Promise<HistoryPage> {
    const { limit, cursor } = historyOptionsSchema.parse(options);
    const { Items, LastEvaluatedKey } = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: OWNER_INDEX_NAME,
        KeyConditionExpression: 'ownerId = :owner',
        ExpressionAttributeValues: { ':owner': ownerId },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: cursor
          ? { ...decodeHistoryCursor(cursor), ownerId }
          : undefined
      }),
      this.deadline()
    );
    return {
      shares: (Items ?? []).map((item) => storedShareSchema.parse(item)),
      nextCursor: LastEvaluatedKey
        ? encodeHistoryCursor({
            id: LastEvaluatedKey.id,
            createdAt: LastEvaluatedKey.createdAt
          })
        : null
    };
  }
}
