import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTranscriptionProvider } from '../../src/shares/transcription/config';
import { transcriptionProvider } from '../../src/shares/server/transcription-config';
import { issueTranscriptionCredential } from '../../src/shares/server/transcription-provider';

test('startup provider names default only when absent and reject invalid values safely', () => {
  assert.equal(parseTranscriptionProvider(undefined), 'openai');
  assert.equal(parseTranscriptionProvider('openai'), 'openai');
  assert.equal(parseTranscriptionProvider('xai'), 'xai');
  for (const value of ['', 'OPENAI', ' xai', 'private-unknown-value'])
    assert.throws(
      () => parseTranscriptionProvider(value),
      /^Error: STT_PROVIDER must be openai or xai$/
    );
});

test('server selection remains fixed after initialization and stale clients cannot issue credentials', async (t) => {
  t.mock.property(process, 'env', { ...process.env, STT_PROVIDER: 'openai' });
  assert.equal(transcriptionProvider(), 'openai');
  process.env.STT_PROVIDER = 'xai';
  assert.equal(transcriptionProvider(), 'openai');
  await assert.rejects(
    issueTranscriptionCredential(
      new AbortController().signal,
      'https://fictional.example',
      'xai'
    ),
    /provider mismatch/
  );
});
