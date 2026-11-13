import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatch } from '../../src/server/app';
import { shareRepository } from '../../src/shares/server/storage/configured-repository';
import { getSession } from '../../src/session/server/session';

const post = (headers: HeadersInit = {}) =>
  dispatch(
    new Request('http://localhost/api/session', { method: 'POST', headers })
  );
test('session bootstrap requires exact same origin, never reads storage, and preserves a valid owner', async (t) => {
  const list = t.mock.method(shareRepository, 'listByOwner', async () => {
    throw new Error('database unavailable');
  });
  const rejectedHeaders: HeadersInit[] = [
    {},
    { origin: 'https://foreign.example' },
    { origin: 'https://foreign.example', 'x-forwarded-host': 'foreign.example' }
  ];
  for (const headers of rejectedHeaders) {
    const rejected = await post(headers);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('set-cookie'), null);
  }
  const created = await post({ origin: 'http://localhost' });
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), { ready: true });
  assert.equal(created.headers.get('cache-control'), 'private, no-store');
  const cookie = created.headers.get('set-cookie')!.split(';')[0];
  const before = await getSession(
    new Request('http://localhost', { headers: { cookie } })
  );
  const resumed = await post({ cookie, origin: 'http://localhost' });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.headers.get('set-cookie'), null);
  assert.equal(
    (await getSession(new Request('http://localhost', { headers: { cookie } })))
      .ownerId,
    before.ownerId
  );
  assert.equal(list.mock.callCount(), 0);
});
test('invalid bootstrap cookies start a distinct owner; unsupported methods never set cookies', async () => {
  const created = await post({ origin: 'http://localhost' });
  const cookie = created.headers.get('set-cookie')!.split(';')[0];
  const replacement = await post({
    origin: 'http://localhost',
    cookie: cookie + 'tampered'
  });
  assert.equal(replacement.status, 200);
  assert.notEqual(replacement.headers.get('set-cookie')!.split(';')[0], cookie);
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
    const response = await dispatch(
      new Request('http://localhost/api/session', { method })
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
  }
});
