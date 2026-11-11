import 'server-only';
import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { dailyTextSchema, readingSchema, type Reading } from '../model';

/** One direct key lookup; missing dates return null, invalid records and SDK failures reject. */
export class DynamoReadingRepository {
  constructor(
    private readonly tableName: string,
    private readonly client: Pick<DynamoDBDocumentClient, 'send'>
  ) {}
  static forRegion(tableName: string, region: string) {
    return new DynamoReadingRepository(
      tableName,
      DynamoDBDocumentClient.from(new DynamoDBClient({ region }))
    );
  }
  async findByDate(date: string): Promise<Reading | null> {
    z.iso.date().parse(date);
    const { Item } = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { date },
        ConsistentRead: true
      })
    );
    if (!Item) return null;
    const text = dailyTextSchema.parse(Item);
    if (text.date !== date)
      throw new Error('Reading date does not match its key.');
    return readingSchema.parse({
      ...text,
      id: `jft-${date}-${createHash('sha256').update(JSON.stringify(text)).digest('hex')}`
    });
  }
}
