import '@hono/zod-openapi';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServerServices } from '../../src/server/services';
import { InMemoryShareRepository } from '../../src/shares/server/storage/memory-repository';
import { DynamoDbShareRepository } from '../../src/shares/server/storage/dynamodb-repository';

const createShareRepository = (env: Record<string, string | undefined>) =>
  createServerServices(env).shares;

test('persistence selection is explicit and invalid settings fail without falling back', () => {
  assert.ok(createShareRepository({}) instanceof InMemoryShareRepository);
  assert.ok(
    createShareRepository({ SHARE_PERSISTENCE: 'memory' }) instanceof
      InMemoryShareRepository
  );
  assert.throws(
    () => createShareRepository({ SHARE_PERSISTENCE: 'unknown' }),
    /SHARE_PERSISTENCE/
  );
  assert.throws(
    () => createShareRepository({ SHARE_PERSISTENCE: 'dynamodb' }),
    /DYNAMODB_TABLE_NAME/
  );
  assert.throws(
    () =>
      createShareRepository({
        SHARE_PERSISTENCE: 'dynamodb',
        DYNAMODB_TABLE_NAME: 'fictional-shares'
      }),
    /DYNAMODB_REGION/
  );
  assert.ok(
    createShareRepository({
      SHARE_PERSISTENCE: 'dynamodb',
      DYNAMODB_TABLE_NAME: 'fictional-shares',
      DYNAMODB_REGION: 'us-west-2'
    }) instanceof DynamoDbShareRepository
  );
});
