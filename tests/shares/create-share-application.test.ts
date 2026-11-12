import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareForReading } from '../../src/shares/server/application/create-share';
import { reflection } from '../fixtures/sample-reading';
import { InMemoryShareRepository } from '../../src/shares/server/storage/memory-repository';

test('save orchestration distinguishes reading failures and revision conflicts from storage failures', async (t) => {
  const repository = new InMemoryShareRepository();
  const write = t.mock.method(repository, 'create');
  const source = {
    findByDate: async () => reflection,
    today: async () => ({
      date: reflection.date,
      reading: reflection,
      sample: true
    })
  };
  const input = {
    text: 'Fictional thoughts.',
    readingDate: reflection.date,
    readingId: reflection.id
  };
  const result = await createShareForReading(
    '00000000-0000-4000-8000-000000000001',
    input,
    'America/Chicago',
    source,
    repository
  );
  assert.deepEqual(result.share?.reflection, reflection);
  assert.deepEqual(
    await createShareForReading(
      '00000000-0000-4000-8000-000000000001',
      { ...input, readingId: 'outdated' },
      'America/Chicago',
      source,
      repository
    ),
    { error: 'READING_CHANGED' }
  );
  assert.deepEqual(
    await createShareForReading(
      '00000000-0000-4000-8000-000000000001',
      input,
      'America/Chicago',
      { ...source, findByDate: async () => null },
      repository
    ),
    { error: 'READING_UNAVAILABLE' }
  );
  assert.deepEqual(
    await createShareForReading(
      '00000000-0000-4000-8000-000000000001',
      input,
      'America/Chicago',
      {
        ...source,
        findByDate: async () => {
          throw new Error('Fictional source failure');
        }
      },
      repository
    ),
    { error: 'READING_UNAVAILABLE' }
  );
  assert.equal(write.mock.callCount(), 1);
  await assert.rejects(
    createShareForReading(
      '00000000-0000-4000-8000-000000000001',
      input,
      'America/Chicago',
      source,
      {
        create: async () => {
          throw new Error('Fictional storage failure');
        }
      }
    ),
    /storage failure/
  );
});
