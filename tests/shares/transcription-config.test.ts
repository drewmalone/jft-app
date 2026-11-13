import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcriptionEngineFactory } from '../../src/shares/transcription/provider';
import { parseTranscriptionProvider } from '../../src/shares/transcription/config';
import { createServerServices } from '../../src/server/services';
import { issueTranscriptionCredential } from '../../src/shares/server/transcription-provider';

test('startup provider names default to Soniox and reject invalid values safely', () => {
  assert.throws(
    () => transcriptionEngineFactory(null),
    /Missing transcription provider bootstrap/
  );
  assert.equal(parseTranscriptionProvider(undefined), 'soniox');
  assert.equal(parseTranscriptionProvider('soniox'), 'soniox');
  assert.equal(parseTranscriptionProvider('openai'), 'openai');
  for (const value of ['', 'OPENAI', 'xai', ' soniox', 'private-unknown-value'])
    assert.throws(
      () => parseTranscriptionProvider(value),
      /^Error: STT_PROVIDER must be soniox or openai$/
    );
});

test('server selection remains fixed after initialization and stale clients cannot issue credentials', async () => {
  const environment = { STT_PROVIDER: 'openai' };
  const services = createServerServices(environment);
  const transcriptionProvider = () => services.features.transcription.provider;
  assert.equal(transcriptionProvider(), 'openai');
  environment.STT_PROVIDER = 'soniox';
  assert.equal(transcriptionProvider(), 'openai');
  await assert.rejects(
    issueTranscriptionCredential(
      transcriptionProvider(),
      new AbortController().signal,
      'soniox'
    ),
    /provider mismatch/
  );
});
