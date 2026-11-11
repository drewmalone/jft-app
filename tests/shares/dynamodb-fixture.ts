import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Isolated local tables with synthetic credentials. Never selects the AWS credential chain. */
export async function dynamoTable(t: TestContext, key: 'id' | 'date') {
  const endpoint = process.env.DYNAMODB_LOCAL_ENDPOINT;
  if (!endpoint) throw new Error('Configure DynamoDB Local explicitly.');
  const client = new DynamoDBClient({
    endpoint,
    region: 'us-west-2',
    credentials: {
      accessKeyId: 'localtestaccesskey0001',
      secretAccessKey: 'localtestsecretaccesskey000000000000000000000000'
    }
  });
  const tableName = `test-${key}-${randomUUID()}`;
  let created = false;
  t.after(async () => {
    try {
      if (created)
        await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      client.destroy();
    }
  });
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: key, KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: key, AttributeType: 'S' },
        ...(key === 'id'
          ? [
              { AttributeName: 'ownerId', AttributeType: 'S' as const },
              { AttributeName: 'createdAt', AttributeType: 'S' as const }
            ]
          : [])
      ],
      ...(key === 'id'
        ? {
            GlobalSecondaryIndexes: [
              {
                IndexName: 'owner-created-at',
                KeySchema: [
                  { AttributeName: 'ownerId', KeyType: 'HASH' as const },
                  { AttributeName: 'createdAt', KeyType: 'RANGE' as const }
                ],
                Projection: { ProjectionType: 'ALL' as const }
              }
            ]
          }
        : {})
    })
  );
  created = true;
  await waitUntilTableExists(
    { client, maxWaitTime: 30 },
    { TableName: tableName }
  );
  return { tableName, documentClient: DynamoDBDocumentClient.from(client) };
}
