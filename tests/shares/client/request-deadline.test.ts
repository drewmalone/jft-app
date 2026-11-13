import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestJson } from '../../../src/http/client';

test('HTTP deadlines abort a stalled fetch once and retain caller cancellation', async (t) => {
  const deadlines: number[] = [];
  const timers: AbortController[] = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    deadlines.push(milliseconds);
    const controller = new AbortController();
    timers.push(controller);
    return controller.signal;
  });
  let calls = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (_path: unknown, options: RequestInit) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        options.signal!.addEventListener(
          'abort',
          () => reject(options.signal!.reason),
          { once: true }
        );
      });
    }
  );
  const pending = requestJson('/fictional');
  timers[0].abort(new DOMException('Timed out', 'TimeoutError'));
  await assert.rejects(pending, { name: 'TimeoutError' });
  const caller = new AbortController();
  const canceled = requestJson(
    '/fictional',
    { signal: caller.signal },
    undefined,
    30000
  );
  caller.abort();
  await assert.rejects(canceled, { name: 'AbortError' });
  assert.deepEqual(deadlines, [15000, 30000]);
  assert.equal(calls, 2);
});
