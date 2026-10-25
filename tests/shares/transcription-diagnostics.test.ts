import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import {
  reportTranscriptionFailure,
  reportTranscriptionConfiguration
} from '../../src/shares/server/transcription-diagnostics';
import { TranscriptionKeyError } from '../../src/shares/server/transcription-key';

test('server transcription diagnostics reveal only safe categories, statuses and allowlisted fields', (t) => {
  const log = t.mock.method(console, 'warn', () => {});
  reportTranscriptionConfiguration('disabled');
  reportTranscriptionFailure(
    new TranscriptionKeyError('missing_key', 'private configuration details')
  );
  reportTranscriptionFailure(
    new OpenAI.APIError(
      403,
      {
        message: 'private credential and transcript',
        code: 'insufficient_permissions',
        param: 'session.audio.input.transcription.model'
      },
      'private raw message',
      new Headers({ 'x-request-id': 'private' })
    )
  );
  reportTranscriptionFailure(
    new OpenAI.APIError(
      400,
      { message: 'private', code: 'private code', param: 'private parameter' },
      'private message',
      new Headers()
    )
  );
  reportTranscriptionFailure(new Error('private connection details'));
  const lines = log.mock.calls.map((call) => call.arguments);
  assert.deepEqual(lines[0], [
    '[Doorknob transcription]',
    { reason: 'disabled' }
  ]);
  assert.deepEqual(lines[1], [
    '[Doorknob transcription]',
    { reason: 'missing_key' }
  ]);
  assert.deepEqual(lines[2], [
    '[Doorknob transcription]',
    {
      reason: 'provider_request_failed',
      status: 403,
      code: 'insufficient_permissions',
      param: 'session.audio.input.transcription.model'
    }
  ]);
  assert.deepEqual(lines[3], [
    '[Doorknob transcription]',
    {
      reason: 'provider_request_failed',
      status: 400,
      code: 'unknown',
      param: 'unknown'
    }
  ]);
  assert.ok(!JSON.stringify(lines).includes('private'));
});
