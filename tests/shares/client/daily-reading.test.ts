import { dom } from '../transcription/client/dom';
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useDailyReading } from '../../../src/readings/use-daily-reading';
import { useShareDraft } from '../../../src/shares/use-share-draft';
import { readingDate } from '../../../src/readings/calendar';
import type { DailyReading } from '../../../src/readings/model';

Object.assign(globalThis, { location: dom.window.location });
afterEach(cleanup);
after(() => dom.window.close());
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
function daily(now: number): DailyReading {
  const date = readingDate(zone, now);
  return {
    date,
    reading: {
      id: date,
      date,
      title: 'Fictional title',
      body: 'Fictional body'
    },
    sample: false
  };
}

test('failed rollover removes the old reading for new drafts and preserves existing draft pins', async (t) => {
  let now = Date.parse('2028-12-03T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const initial = daily(now);
  let available = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!available) throw new Error('Fictional offline failure');
    return Response.json(daily(now));
  });
  const hook = renderHook(() => {
    const reading = useDailyReading(initial);
    return {
      reading,
      empty: useShareDraft(reading.daily),
      active: useShareDraft(reading.daily)
    };
  });
  act(() => hook.result.current.active.edit('An existing fictional draft.'));
  now += 86400_000;
  await act(async () => {
    window.dispatchEvent(new dom.window.Event('focus'));
  });
  assert.equal(hook.result.current.reading.failed, true);
  assert.equal(hook.result.current.reading.daily.reading, null);
  assert.equal(
    hook.result.current.active.displayedReading.reading?.id,
    initial.reading!.id
  );
  act(() => hook.result.current.empty.edit('A new fictional draft.'));
  assert.equal(hook.result.current.empty.pinned, null);
  assert.equal(hook.result.current.empty.displayedReading.reading, null);
  available = true;
  await act(async () => hook.result.current.reading.retry());
  assert.equal(
    (hook.result.current.empty.displayedReading as DailyReading).reading?.date,
    daily(now).date
  );
  assert.equal(
    hook.result.current.active.displayedReading.reading?.id,
    initial.reading!.id
  );
});

test('a request deadline releases loading and permits retry; unmount aborts an in-flight retry', async (t) => {
  let now = Date.parse('2028-12-03T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  let deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 15_000);
    return deadline.signal;
  });
  const signals: AbortSignal[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signals.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true
        });
      })
  );
  const hook = renderHook(() =>
    useDailyReading(daily(Date.parse('2028-12-03T12:00:00Z')))
  );
  now += 86400_000;
  act(() => window.dispatchEvent(new dom.window.Event('focus')));
  assert.equal(hook.result.current.loading, true);
  await act(async () =>
    deadline.abort(new DOMException('Fictional timeout', 'TimeoutError'))
  );
  assert.equal(hook.result.current.loading, false);
  assert.equal(hook.result.current.failed, true);
  deadline = new AbortController();
  act(() => hook.result.current.retry());
  assert.equal(signals.length, 2);
  assert.equal(hook.result.current.loading, true);
  hook.unmount();
  assert.equal(signals[1].aborted, true);
});
