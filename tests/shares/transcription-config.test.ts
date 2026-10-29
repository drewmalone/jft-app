import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcriptionEngineFactory } from '../../src/shares/transcription/provider';
import { parseTranscriptionProvider } from '../../src/shares/transcription/config';
import { transcriptionProvider } from '../../src/shares/server/transcription-config';
import { issueTranscriptionCredential } from '../../src/shares/server/transcription-provider';

test('startup provider names require an explicit value and reject invalid values safely', () => {
  assert.throws(
    () => transcriptionEngineFactory(null),
    /Missing transcription provider bootstrap/
  );
  assert.equal(parseTranscriptionProvider('openai'), 'openai');
  assert.equal(parseTranscriptionProvider('xai'), 'xai');
  for (const value of [
    undefined,
    '',
    'OPENAI',
    ' xai',
    'private-unknown-value'
  ])
    assert.throws(
      () => parseTranscriptionProvider(value),
      /^Error: STT_PROVIDER must be explicitly set to openai or xai$/
    );
});

test('server selection remains fixed after initialization and stale clients cannot issue credentials', async (t) => {
  t.mock.property(process, 'env', { ...process.env, STT_PROVIDER: 'openai' });
  assert.equal(transcriptionProvider(), 'openai');
  process.env.STT_PROVIDER = 'xai';
  assert.equal(transcriptionProvider(), 'openai');
  await assert.rejects(
    issueTranscriptionCredential(
      transcriptionProvider(),
      new AbortController().signal,
      'xai'
    ),
    /provider mismatch/
  );
});
