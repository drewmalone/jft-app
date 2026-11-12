import { dom } from '../../transcription/client/dom';
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useShareApplication } from '../../../../src/shares/use-share-application';
import type { DailyReading } from '../../../../src/readings/model';

afterEach(cleanup);
after(() => dom.window.close());
function daily(date: string): DailyReading {
  return {
    date,
    reading: {
      date,
      id: date,
      title: `Fictional ${date}`,
      body: 'Fictional text.'
    },
    sample: true
  };
}
test('typed and recording drafts retain their reading across rollover and navigation, then release it when cleared', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ shares: [], nextCursor: null })
  );
  const first = daily('2026-11-11'),
    next = daily('2026-11-12');
  const hook = renderHook(({ value }) => useShareApplication(value, () => {}), {
    initialProps: { value: first }
  });
  await act(async () => {});
  act(() => hook.result.current.cleanup.edit('Fictional draft.'));
  hook.rerender({ value: next });
  assert.equal(
    hook.result.current.displayedReading.reading?.id,
    first.reading!.id
  );
  act(() => hook.result.current.navigate({ view: 'past' }));
  await act(async () => {});
  act(() => hook.result.current.navigate({ view: 'today' }));
  assert.equal(
    hook.result.current.displayedReading.reading?.id,
    first.reading!.id
  );
  act(() => hook.result.current.cleanup.edit(''));
  assert.equal(
    hook.result.current.displayedReading.reading?.id,
    next.reading!.id
  );
  act(() => hook.result.current.recordingChanged(true));
  hook.rerender({ value: first });
  assert.equal(
    hook.result.current.displayedReading.reading?.id,
    next.reading!.id
  );
  act(() => hook.result.current.recordingChanged(false));
  assert.equal(
    hook.result.current.displayedReading.reading?.id,
    first.reading!.id
  );
});
