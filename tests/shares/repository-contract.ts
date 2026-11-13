import {
  submissionFor,
  SubmissionConflict
} from '../../src/shares/server/storage/submission';
import { reflection } from '../fixtures/sample-reading';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ShareRepository } from '../../src/shares/server/storage/repository';
import { readPublicShare } from '../../src/shares/server/application/read-public-share';

/** Reusable behavioral checks for memory and DynamoDB; no SDK-specific expectations. */
export async function repositoryContract(repository: ShareRepository) {
  const owner = randomUUID();
  const saved = await repository.create(
    owner,
    '  Fictional contract text.  ',
    reflection
  );
  assert.equal(saved.text, 'Fictional contract text.');
  assert.equal(await repository.findByOwner(saved.id, randomUUID()), null);
  assert.equal(await repository.findById('invalid'), null);
  assert.equal(await repository.findById(randomUUID()), null);
  const history = (
    await eventuallyHistory(repository, owner, (page) =>
      page.shares.some((share) => share.id === saved.id)
    )
  ).shares;
  assert.deepEqual(
    history.map((share) => share.id),
    [saved.id]
  );
  history[0].text = 'History mutation';
  assert.equal(
    (await repository.findById(saved.id))?.text,
    'Fictional contract text.'
  );
  assert.deepEqual((await repository.listByOwner(randomUUID())).shares, []);
  saved.text = 'Mutation';
  const read = await repository.findByOwner(saved.id, owner);
  assert.equal(read?.text, 'Fictional contract text.');
  read!.reflection.title = 'Mutation';
  assert.notEqual(
    (await repository.findById(saved.id))?.reflection.title,
    'Mutation'
  );
  await assert.rejects(repository.create(owner, ' ', reflection));
  await assert.rejects(
    repository.create('invalid', 'Fictional text.', reflection)
  );
  // Legacy TTL metadata is not part of new records: links alone expire.
  assert.equal('expiresAt' in (await repository.findById(saved.id))!, false);
  assert.ok(await readPublicShare(saved.id, repository));
  const replayOwner = randomUUID();
  const input = { text: 'Fictional retry.' };
  const key = randomUUID();
  const submission = submissionFor(key, input);
  const first = await repository.create(
    replayOwner,
    input.text,
    reflection,
    submission
  );
  assert.deepEqual(
    await repository.create(replayOwner, input.text, reflection, submission),
    first
  );
  assert.deepEqual(
    await repository.findBySubmission(replayOwner, submission),
    first
  );
  await assert.rejects(
    repository.findBySubmission(
      replayOwner,
      submissionFor(key, { text: 'Changed fictional draft.' })
    ),
    SubmissionConflict
  );
  await assert.rejects(
    repository.create(
      replayOwner,
      'Changed fictional draft.',
      reflection,
      submissionFor(key, { text: 'Changed fictional draft.' })
    ),
    SubmissionConflict
  );
  const otherOwner = await repository.create(
    randomUUID(),
    input.text,
    reflection,
    submission
  );
  assert.notEqual(otherOwner.id, first.id);
  const intentional = await repository.create(
    replayOwner,
    input.text,
    reflection,
    submissionFor(randomUUID(), input)
  );
  assert.notEqual(intentional.id, first.id);
  const replayHistory = await eventuallyHistory(
    repository,
    replayOwner,
    (page) => page.shares.length === 2
  );
  assert.equal(replayHistory.shares.length, 2);
  assert.ok(
    replayHistory.shares.every((share) => !share.id.startsWith('submission:'))
  );
}

/** GSI history is eventually consistent; detail reads above retain their immediate assertion. */
export async function eventuallyHistory(
  repository: ShareRepository,
  owner: string,
  ready: (page: Awaited<ReturnType<ShareRepository['listByOwner']>>) => boolean
) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const page = await repository.listByOwner(owner);
    if (ready(page)) return page;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    'Fictional history was not visible within the bounded consistency window.'
  );
}
