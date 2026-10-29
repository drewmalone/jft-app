import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createXaiTranscript } from '../../../services/xai-relay/transcript.mjs';

const partial = (
  text: string,
  start: number,
  duration: number,
  is_final = false,
  speech_final = false
) => ({
  type: 'transcript.partial',
  text,
  start,
  duration,
  is_final,
  speech_final
});
function setup() {
  const finals: string[] = [],
    interims: string[] = [];
  return {
    finals,
    interims,
    transcript: createXaiTranscript({
      final: (text) => finals.push(text),
      interim: (text) => interims.push(text)
    })
  };
}

test('locked chunks commit immediately and cumulative utterances and summaries do not repeat them', () => {
  const s = setup();
  s.transcript.accept(partial('Hello', 0, 1));
  s.transcript.accept(partial('Hello there.', 0, 2));
  assert.equal(s.interims.at(-1), 'Hello there.');
  assert.deepEqual(s.finals, []);
  s.transcript.accept(partial('Hello there.', 0, 2, true));
  assert.deepEqual(s.finals, ['Hello there.']);
  s.transcript.accept(partial('Again.', 2, 1, true));
  s.transcript.accept(partial('Hello there. Again.', 0, 3, true, true));
  s.transcript.accept(partial('Hello there. Again.', 0, 3, true, true));
  assert.equal(
    s.transcript.accept({
      type: 'transcript.done',
      text: 'Hello there. Again.',
      duration: 3
    }),
    true
  );
  assert.deepEqual(s.finals, ['Hello there.', 'Again.']);
});

test('cumulative finals and interim text contain only unseen words, preserving intentional repetition', () => {
  const s = setup();
  s.transcript.accept(partial('Again.', 0, 1, true));
  const words = [
    { text: 'Again.', start: 0, end: 1 },
    { text: 'Again.', start: 1.2, end: 2 }
  ];
  s.transcript.accept({ ...partial('Again. Again.', 0, 2), words });
  assert.equal(s.interims.at(-1), 'Again.');
  s.transcript.accept({
    ...partial('Again. Again.', 0, 2, true, true),
    words: [...words].reverse()
  });
  s.transcript.accept({
    type: 'transcript.done',
    duration: 2,
    text: 'Again. Again.',
    words
  });
  assert.deepEqual(s.finals, ['Again.', 'Again.']);
});

test('done supplies trailing words and empty silence completes normally', () => {
  const silent = setup();
  assert.equal(
    silent.transcript.accept({
      type: 'transcript.done',
      text: '',
      duration: 1
    }),
    true
  );
  assert.deepEqual(silent.finals, []);
  const s = setup();
  s.transcript.accept(partial('First.', 0, 1, true, true));
  s.transcript.accept({
    type: 'transcript.done',
    text: 'First. Trailing.',
    duration: 2,
    words: [
      { text: 'First.', start: 0, end: 1 },
      { text: 'Trailing.', start: 1.2, end: 2 }
    ]
  });
  assert.deepEqual(s.finals, ['First.', 'Trailing.']);
});

test('duplicate and stale fragments are ignored; conflicting, out-of-order or malformed finals fail without changing committed words', () => {
  const s = setup();
  s.transcript.accept(partial('Keep.', 0, 1, true));
  s.transcript.accept(partial('Keep.', 0, 1, true));
  s.transcript.accept(partial('Stale.', 0, 0.5));
  assert.throws(
    () => s.transcript.accept(partial('Unknown old chunk.', 0.2, 0.2, true)),
    /Out of order/
  );
  assert.throws(
    () =>
      s.transcript.accept(partial('Ambiguous overlap.', 0.5, 1, true, true)),
    /reconcile/
  );
  assert.throws(() =>
    s.transcript.accept({
      ...partial('Invalid flags.', 1, 1),
      speech_final: true
    })
  );
  assert.throws(() =>
    s.transcript.accept({ ...partial('Invalid.', 1, 1, true), text: {} })
  );
  assert.throws(() =>
    s.transcript.accept({ type: 'error', message: 'private details' })
  );
  assert.deepEqual(s.finals, ['Keep.']);
});

test('summaries without word timestamps need an exact prefix, and overlapping words never append duplicates', () => {
  const s = setup();
  s.transcript.accept(partial('Go', 0, 1, true));
  assert.throws(
    () =>
      s.transcript.accept({
        type: 'transcript.done',
        text: 'Good',
        duration: 2
      }),
    /reconcile/
  );
  assert.throws(
    () =>
      s.transcript.accept({
        type: 'transcript.done',
        text: 'Go now',
        duration: 2,
        words: [
          { text: 'Go', start: 0, end: 1.2 },
          { text: 'now', start: 1, end: 2 }
        ]
      }),
    /timestamps/
  );
  s.transcript.accept({ type: 'transcript.done', text: 'Go now', duration: 2 });
  assert.deepEqual(s.finals, ['Go', 'now']);
});

test('cumulative interim and final text without words match the current utterance after earlier utterances', () => {
  const s = setup();
  s.transcript.accept(partial('First.', 0, 1, true, true));
  s.transcript.accept(partial('Second', 2, 1, true));
  s.transcript.accept(partial('Second phrase', 2, 2));
  assert.equal(s.interims.at(-1), 'phrase');
  s.transcript.accept(partial('Second phrase.', 2, 2, true, true));
  s.transcript.accept({
    type: 'transcript.done',
    text: 'First. Second phrase.',
    duration: 4
  });
  assert.deepEqual(s.finals, ['First.', 'Second', 'phrase.']);
});
