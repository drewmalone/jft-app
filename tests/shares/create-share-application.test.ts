import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareService } from '../../src/shares/server/application/create-share';
import { reflection } from '../fixtures/sample-reading';
import { InMemoryShareRepository } from '../../src/shares/server/storage/memory-repository';

test('save orchestration distinguishes reading failures and revision conflicts from storage failures', async (t) => {
  const repository = new InMemoryShareRepository();
  const write = t.mock.method(repository, 'create');
  const readings = {
    findByDate: async () => reflection,
    today: async () => ({
      date: reflection.date,
      reading: reflection,
      sample: true
    })
  };
  let reservations = 0;
  const reserveCreate = async () => {
    reservations++;
  };
  const service = createShareService({ repository, readings, reserveCreate });
  const request = {
    ownerId: '00000000-0000-4000-8000-000000000001',
    timeZone: 'America/Chicago',
    input: {
      text: 'Fictional thoughts.',
      readingDate: reflection.date,
      readingId: reflection.id
    }
  };
  assert.deepEqual((await service.save(request)).share?.reflection, reflection);
  assert.deepEqual(
    await service.save({
      ...request,
      input: { ...request.input, readingId: 'outdated' }
    }),
    { error: 'READING_CHANGED' }
  );
  for (const findByDate of [
    async () => null,
    async () => {
      throw new Error('Fictional source failure');
    }
  ]) {
    const unavailable = createShareService({
      repository,
      readings: { ...readings, findByDate },
      reserveCreate
    });
    assert.deepEqual(await unavailable.save(request), {
      error: 'READING_UNAVAILABLE'
    });
  }
  assert.equal(write.mock.callCount(), 1);
  assert.equal(reservations, 1);
  const broken = createShareService({
    repository: {
      findBySubmission: async () => null,
      create: async () => {
        throw new Error('Fictional storage failure');
      }
    },
    readings,
    reserveCreate
  });
  await assert.rejects(broken.save(request), /storage failure/);
});
