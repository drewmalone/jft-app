import { dom } from '../transcription/client/dom';
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode, createElement, type ReactNode } from 'react';
import { useSession } from '../../../src/session/use-session';
import { useShareApplication } from '../../../src/shares/use-share-application';
import { reflection } from '../../fixtures/sample-reading';

afterEach(cleanup);
after(() => dom.window.close());
test('Strict Mode and simultaneous retries serialize one session request; retries are explicit', async () => {
  let calls = 0;
  let release!: () => void;
  let fail = true;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = async () => {
    calls++;
    await pending;
    if (fail) throw new Error('offline');
  };
  const hook = renderHook(() => useSession(request), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, children)
  });
  await act(async () => {});
  assert.equal(calls, 1);
  await act(async () => {
    release();
  });
  assert.equal(hook.result.current.state.status, 'failed');
  assert.equal(calls, 1);
  fail = false;
  await act(async () => {
    await Promise.all([
      hook.result.current.retry(),
      hook.result.current.retry()
    ]);
  });
  assert.equal(calls, 2);
  assert.equal(hook.result.current.ready, true);
});
test('session readiness never loads history and survives a later history outage without discarding a draft', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    urls.push(String(url));
    if (String(url) === '/api/session') return Response.json({ ready: true });
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Please try again.' } },
      { status: 500 }
    );
  });
  const hook = renderHook(() =>
    useShareApplication(
      { date: reflection.date, reading: reflection, sample: true },
      () => {}
    )
  );
  await act(async () => {});
  assert.equal(hook.result.current.sessionReady, true);
  assert.deepEqual(urls, ['/api/session']);
  act(() => hook.result.current.cleanup.edit('Fictional words to keep.'));
  await act(async () => hook.result.current.navigate({ view: 'past' }));
  assert.equal(hook.result.current.history.status, 'failed');
  assert.equal(hook.result.current.sessionReady, true);
  act(() => hook.result.current.navigate({ view: 'today' }));
  assert.equal(hook.result.current.text, 'Fictional words to keep.');
});
