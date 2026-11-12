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
export async function dynamoTable(t: TestContext) {
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
  const tableName = `test-shares-${randomUUID()}`;
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
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'ownerId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'owner-created-at',
          KeySchema: [
            { AttributeName: 'ownerId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' }
        }
      ]
    })
  );
  created = true;
  await waitUntilTableExists(
    { client, maxWaitTime: 30 },
    { TableName: tableName }
  );
  return { tableName, documentClient: DynamoDBDocumentClient.from(client) };
}
