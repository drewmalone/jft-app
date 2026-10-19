import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serializeSigned } from 'hono/utils/cookie';
import { dispatch } from '../../src/shares/server/app';
import { shareRepository } from '../../src/shares/server/repository';
import { getSession } from '../../src/shares/server/session';

const key = 'fictional-recovery-session-key-at-least-32-bytes';
const now = 1_800_000_000;
function request(
  path: string,
  method = 'GET',
  cookie?: string,
  origin?: string
) {
  return dispatch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) }
    })
  );
}
function cookieFrom(response: Response) {
  return response.headers.get('set-cookie')!.split(';')[0];
}

test('explicit recovery replaces stale, malformed, expired or missing credentials without returning private data', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: key
  });
  t.mock.method(Date, 'now', () => now * 1000);
  const ownerId = randomUUID();
  const stale = await serializeSigned(
    'doorknob-session',
    JSON.stringify({ ownerId, expiresAt: now + 3600 }),
    'fictional-prior-process-secret-at-least-32-bytes'
  );
  const expired = await serializeSigned(
    'doorknob-session',
    JSON.stringify({ ownerId, expiresAt: now - 1 }),
    key
  );
  const oldShare = await shareRepository.create(
    ownerId,
    'A fictional old session thought.'
  );
  for (const cookie of [
    stale,
    expired,
    'doorknob-session=forged',
    'doorknob-session=',
    undefined
  ]) {
    if (cookie) {
      const rejected = await request('/api/shares', 'GET', cookie);
      assert.equal(rejected.status, 401);
      assert.equal(rejected.headers.get('set-cookie'), null);
    }
    const recovered = await request(
      '/api/session/reset',
      'POST',
      cookie,
      'http://localhost'
    );
    assert.equal(recovered.status, 204);
    assert.equal(await recovered.text(), '');
    assert.equal(recovered.headers.get('cache-control'), 'private, no-store');
    assert.match(recovered.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(recovered.headers.get('set-cookie')!, /Secure/);
    const replacement = cookieFrom(recovered);
    const session = await getSession(
      new Request('http://localhost', { headers: { cookie: replacement } })
    );
    assert.notEqual(session.ownerId, ownerId);
    assert.equal(session.newSession, null);
    assert.deepEqual(
      await (await request('/api/shares', 'GET', replacement)).json(),
      []
    );
    assert.equal(
      (await request(`/api/shares/${oldShare.id}`, 'GET', replacement)).status,
      404
    );
  }
  assert.ok(await shareRepository.findByOwner(oldShare.id, ownerId));
});

test('recovery preserves a valid owner and fails closed when configuration is invalid', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: key
  });
  const initial = await request('/api/shares');
  const cookie = cookieFrom(initial);
  const { ownerId } = await getSession(
    new Request('http://localhost', { headers: { cookie } })
  );
  const saved = await shareRepository.create(
    ownerId,
    'A fictional retained thought.'
  );
  const recovered = await request('/api/session/reset', 'POST', cookie);
  assert.equal(recovered.status, 204);
  assert.equal(recovered.headers.get('set-cookie'), null);
  assert.equal(
    (await request(`/api/shares/${saved.id}`, 'GET', cookie)).status,
    200
  );
  for (const configured of ['', 'short']) {
    process.env.SESSION_SECRET = configured;
    const failed = await request(
      '/api/session/reset',
      'POST',
      'doorknob-session=forged'
    );
    assert.equal(failed.status, 500);
    assert.equal(failed.headers.get('set-cookie'), null);
    assert.equal((await failed.json()).error.code, 'INTERNAL_ERROR');
  }
});

test('cross-origin and unsupported recovery requests never change cookies', async () => {
  for (const cookie of [undefined, 'doorknob-session=forged']) {
    const rejected = await request(
      '/api/session/reset',
      'POST',
      cookie,
      'https://foreign.example'
    );
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('set-cookie'), null);
  }
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await request(
      '/api/session/reset',
      method,
      'doorknob-session=forged'
    );
    assert.equal(response.status, method === 'OPTIONS' ? 204 : 405);
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
    assert.equal(response.headers.get('set-cookie'), null);
  }
});
