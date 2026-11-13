import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initialApplicationState,
  reduceApplication
} from '../../../src/shares/application-state';
import {
  initialRecordingState,
  reduceRecording
} from '../../../src/shares/transcription/recording-state';

test('starting a new save clears the previous failure without changing the selected screen', () => {
  const failed = reduceApplication(initialApplicationState, {
    type: 'saveFailed',
    message: 'Fictional failure'
  });
  const past = reduceApplication(failed, {
    type: 'navigate',
    screen: { view: 'past' }
  });
  const pending = reduceApplication(past, { type: 'saveStarted' });
  assert.deepEqual(pending.save, { status: 'saving' });
  assert.equal(pending.screen.view, 'past');
  assert.equal(reduceApplication(pending, { type: 'clearSaveError' }), pending);
});

test('late connection callbacks cannot resume a stopping recorder and finalization clears provisional words', () => {
  const started = reduceRecording(initialRecordingState, { type: 'start' });
  const interim = reduceRecording(started, {
    type: 'interim',
    text: 'Fictional provisional words.'
  });
  const stopping = reduceRecording(interim, { type: 'stop' });
  assert.equal(reduceRecording(stopping, { type: 'connecting' }), stopping);
  assert.equal(reduceRecording(stopping, { type: 'listening' }), stopping);
  const finished = reduceRecording(stopping, {
    type: 'finish',
    failed: true,
    message: 'Fictional interruption'
  });
  assert.equal(finished.interim, '');
  assert.equal(finished.speaking, false);
  assert.equal(finished.state, 'error');
  assert.equal(finished.message, 'Fictional interruption');
});
