import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecordingControls } from '../../../../src/shares/composer/recording/recording-controls';
import { RecordingStatus } from '../../../../src/shares/composer/recording/recording-status';
import type { TranscriptionState } from '../../../../src/shares/transcription/types';

for (const [state, message, label] of [
  ['idle', '', 'Tap to begin'],
  ['idle', 'Tap to record more.', 'Paused'],
  ['listening', '', 'Listening…'],
  ['connecting', '', 'Connecting transcription…'],
  ['stopping', '', 'Finishing your words…'],
  ['error', 'Provider error', 'Recording interrupted']
] as const) {
  test(`recording status: ${state} ${message}`, () => {
    const html = renderToStaticMarkup(
      createElement(RecordingStatus, { state, message })
    );
    assert.ok(html.includes(label));
    assert.ok(html.includes('aria-live="polite"'));
  });
}

test('microphone uses a pause icon while active and remains retryable after errors', () => {
  const control = (state: TranscriptionState, active: boolean) =>
    renderToStaticMarkup(
      createElement(RecordingControls, {
        state,
        active,
        disabled: false,
        onToggle() {}
      })
    );
  assert.match(control('listening', true), /aria-label="Stop listening"/);
  assert.match(control('listening', true), /x="14"/);
  assert.match(control('idle', false), /Microphone|x="9"/);
  assert.doesNotMatch(control('error', false), /disabled/);
  assert.match(control('stopping', true), /disabled/);
});
