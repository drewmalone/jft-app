import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { dispatch } from '../../src/shares/server/app';
import { useReadingFixture as setupReadingFixture } from '../fixtures/reading-service';
import { reflection } from '../fixtures/sample-reading';

const original = 'Um, a fictional thought. Another thought.';
const cleaned = 'A fictional thought.\n\nAnother thought.';
function enable(t: TestContext) {
  setupReadingFixture(t);
  t.mock.property(process, 'env', {
    ...process.env,
    STT_ENABLED: 'true',
    STT_OPENAI_API_KEY: 'fictional-key'
  });
  t.mock.method(console, 'warn', () => {});
}
function output(text = cleaned, status = 'completed') {
  return Response.json({
    id: 'resp_fiction',
    object: 'response',
    status,
    output: [
      {
        type: 'message',
        id: 'msg_fiction',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({ text }),
            annotations: []
          }
        ]
      }
    ]
  });
}
async function session() {
  return (await dispatch(new Request('http://localhost/api/shares'))).headers
    .get('set-cookie')!
    .split(';')[0];
}
function save(
  cookie?: string,
  input: object = { text: original, tidy: true },
  origin: string | null = 'http://localhost'
) {
  return dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(origin ? { origin } : {})
      },
      body: JSON.stringify(input)
    })
  );
}
async function list(cookie: string) {
  return (
    await dispatch(
      new Request('http://localhost/api/shares', { headers: { cookie } })
    )
  ).json();
}

test('tidying during save requires exact origin and an existing session; disabled cleanup incurs no provider call', async (t) => {
  enable(t);
  const calls = t.mock.method(globalThis, 'fetch', async () => output());
  const cookie = await session();
  const missingSession = await save();
  assert.equal(missingSession.status, 403);
  assert.equal(missingSession.headers.get('set-cookie'), null);
  assert.equal((await save(cookie, undefined, null)).status, 403);
  assert.equal(
    (await save(cookie, undefined, 'https://foreign.example')).status,
    403
  );
  assert.equal(
    (await save(cookie, { text: original, tidy: 'true' })).status,
    400
  );
  assert.equal(calls.mock.callCount(), 0);
  process.env.STT_ENABLED = 'false';
  const response = await save(cookie);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).text, original);
  assert.equal(calls.mock.callCount(), 0);
});

test('save validates the reading before paid cleanup and persists only the final cleaned text', async (t) => {
  enable(t);
  const cookie = await session();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const called = new Promise<void>((resolve) => {
    started = resolve;
  });
  const calls = t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = await request.json();
      assert.equal(body.store, false);
      assert.equal(body.input, original);
      started();
      await waiting;
      return output();
    }
  );
  assert.equal(
    (
      await save(cookie, {
        text: original,
        tidy: true,
        readingDate: reflection.date,
        readingId: 'stale'
      })
    ).status,
    409
  );
  assert.equal(calls.mock.callCount(), 0);
  const pending = save(cookie, {
    text: original,
    tidy: true,
    readingDate: reflection.date,
    readingId: reflection.id
  });
  await called;
  assert.deepEqual(await list(cookie), []);
  release();
  const response = await pending;
  assert.equal(response.status, 201);
  const share = await response.json();
  assert.equal(share.text, cleaned);
  assert.deepEqual(share.reflection, reflection);
  assert.equal((await list(cookie))[0].text, cleaned);
  const recipient = await dispatch(
    new Request(`http://localhost/api/public/shares/${share.id}`)
  );
  assert.equal((await recipient.json()).text, cleaned);
});

test('failed tidying writes nothing; opting out can save the original text', async (t) => {
  enable(t);
  const calls = t.mock.method(globalThis, 'fetch', async () =>
    output(cleaned, 'incomplete')
  );
  const cookie = await session();
  const failed = await save(cookie);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error.code, 'CLEANUP_UNAVAILABLE');
  assert.deepEqual(await list(cookie), []);
  const saved = await save(cookie, { text: original });
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).text, original);
  assert.equal(calls.mock.callCount(), 1);
});

test('tidying during save consumes the existing cleanup quota before calling the provider', async (t) => {
  enable(t);
  const calls = t.mock.method(globalThis, 'fetch', async () => output());
  const cookie = await session();
  for (let i = 0; i < 5; i++) assert.equal((await save(cookie)).status, 201);
  const limited = await save(cookie);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(calls.mock.callCount(), 5);
  assert.equal((await list(cookie)).length, 5);
});
