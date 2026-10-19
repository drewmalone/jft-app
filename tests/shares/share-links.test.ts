import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import {
  createShareLink,
  verifyShareLink
} from '../../src/shares/server/share-links';
import { readPublicShare } from '../../src/shares/server/public-shares';
import { InMemoryShareRepository } from '../../src/shares/server/repository';
import { dispatch } from '../../src/shares/server/app';
import { reflection } from '../../src/shares/reflection-fixture';

const now = 1_800_000_000;
const key = 'fictional-link-unit-test-key-at-least-32-bytes';
function parameters(url: string) {
  return new URL(url, 'http://localhost').searchParams;
}
function request(
  path: string,
  method = 'GET',
  cookie?: string,
  headers?: HeadersInit
) {
  const supplied = new Headers(headers);
  if (cookie) supplied.set('cookie', cookie);
  return dispatch(
    new Request(`http://localhost${path}`, { method, headers: supplied })
  );
}
async function create() {
  const response = await dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'A fictional thought shared intentionally.'
      })
    })
  );
  return {
    share: await response.json(),
    cookie: response.headers.get('set-cookie')!.split(';')[0]
  };
}

test('versioned HMAC binds the exact ID and canonical expiry; rejects tampering and malformed credentials', (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    SHARE_LINK_SECRET: key,
    SHARE_LINK_TTL_SECONDS: undefined
  });
  const id = randomUUID();
  const link = createShareLink(id, now);
  assert.equal(link.expiresAt, now + 604800);
  const query = parameters(link.url);
  const expires = query.get('expires')!;
  const sig = query.get('sig')!;
  const expected = createHmac('sha256', key)
    .update(`share:v1\n${id}\n${expires}`)
    .digest('base64url');
  assert.equal(sig, expected);
  assert.equal(verifyShareLink(id, expires, sig, now), true);
  assert.equal(verifyShareLink(randomUUID(), expires, sig, now), false);
  assert.equal(
    verifyShareLink(id, String(Number(expires) + 1), sig, now),
    false
  );
  assert.equal(
    verifyShareLink(
      id,
      expires,
      `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`,
      now
    ),
    false
  );
  assert.equal(verifyShareLink(id, expires, sig, link.expiresAt), false);
  for (const bad of [
    undefined,
    null,
    [],
    [expires, expires],
    '',
    '0',
    '-1',
    '1.5',
    '1e10',
    `0${expires}`,
    ` ${expires}`,
    '9007199254740992'
  ])
    assert.equal(verifyShareLink(id, bad, sig, now), false);
  for (const bad of [
    undefined,
    [],
    '',
    sig + '=',
    sig.slice(1),
    '!'.repeat(43),
    'A'.repeat(44)
  ])
    assert.equal(verifyShareLink(id, expires, bad, now), false);
  assert.equal(verifyShareLink('invalid', expires, sig, now), false);
  assert.throws(() => createShareLink('invalid', now));
  assert.throws(() => createShareLink(id, NaN));
  const differentPurpose = createHmac('sha256', key)
    .update(`session:v1\n${id}\n${expires}`)
    .digest('base64url');
  assert.equal(verifyShareLink(id, expires, differentPurpose, now), false);
});

test('separate process-stable development key, configurable lifetime, and fail-closed production configuration', (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    NODE_ENV: 'development',
    SESSION_SECRET: undefined,
    SHARE_LINK_SECRET: undefined,
    SHARE_LINK_TTL_SECONDS: undefined
  });
  const id = randomUUID();
  assert.deepEqual(createShareLink(id, now), createShareLink(id, now));
  process.env.SHARE_LINK_TTL_SECONDS = '60';
  assert.equal(createShareLink(id, now).expiresAt, now + 60);
  for (const value of ['', '0', '-1', '1.5', '31536001', 'abc']) {
    process.env.SHARE_LINK_TTL_SECONDS = value;
    assert.throws(() => createShareLink(id, now));
  }
  delete process.env.SHARE_LINK_TTL_SECONDS;
  Object.assign(process.env, { NODE_ENV: 'production' });
  for (const value of [undefined, '', 'short']) {
    if (value === undefined) delete process.env.SHARE_LINK_SECRET;
    else process.env.SHARE_LINK_SECRET = value;
    assert.throws(() => createShareLink(id, now));
    assert.throws(() =>
      verifyShareLink(id, String(now + 100), 'A'.repeat(43), now)
    );
  }
  process.env.SHARE_LINK_SECRET = key;
  process.env.SESSION_SECRET = key;
  assert.throws(() => createShareLink(id, now));
  process.env.SESSION_SECRET = 'a-different-fictional-session-secret';
  assert.ok(createShareLink(id, now).url);
});

test('public service verifies before storage and projects only intended content from detached reads', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    SHARE_LINK_SECRET: key,
    SHARE_LINK_TTL_SECONDS: '60'
  });
  const store = new InMemoryShareRepository();
  const saved = await store.create(
    randomUUID(),
    'Fictional public service text.'
  );
  const link = createShareLink(saved.id, now);
  const query = parameters(link.url);
  const lookup = t.mock.method(store, 'findById');
  assert.equal(
    await readPublicShare(
      saved.id,
      query.get('expires'),
      'invalid',
      store,
      now
    ),
    null
  );
  assert.equal(lookup.mock.callCount(), 0);
  const projected = await readPublicShare(
    saved.id,
    query.get('expires'),
    query.get('sig'),
    store,
    now
  );
  assert.deepEqual(projected, { reflection, text: saved.text });
  assert.equal(lookup.mock.callCount(), 1);
  const detached = await store.findById(saved.id);
  detached!.text = 'Changed';
  assert.equal((await store.findById(saved.id))?.text, saved.text);
  // Same valid capability, absent underlying record (e.g. after restart or future deletion).
  assert.equal(
    await readPublicShare(
      saved.id,
      query.get('expires'),
      query.get('sig'),
      new InMemoryShareRepository(),
      now
    ),
    null
  );
});

test('link API enforces existing session, owner and same-origin; public API has no session side effects', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    SHARE_LINK_SECRET: key,
    SHARE_LINK_TTL_SECONDS: '604800'
  });
  t.mock.method(Date, 'now', () => now * 1000);
  const { share, cookie } = await create();
  const foreign = await create();
  const path = `/api/shares/${share.id}/link`;
  for (const credential of [undefined, 'doorknob-session=invalid']) {
    const response = await request(path, 'POST', credential);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const other = await request(path, 'POST', foreign.cookie);
  const missing = await request(
    `/api/shares/${randomUUID()}/link`,
    'POST',
    cookie
  );
  assert.equal(other.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await other.json(), await missing.json());
  const crossOrigin = await request(path, 'POST', cookie, {
    origin: 'https://elsewhere.example'
  });
  assert.equal(crossOrigin.status, 403);
  const response = await request(path, 'POST', cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const link = await response.json();
  assert.deepEqual(Object.keys(link).sort(), ['expiresAt', 'url']);
  assert.equal(link.expiresAt, now + 604800);
  assert.equal(JSON.stringify(link).includes(key), false);
  assert.equal(JSON.stringify(link).includes(share.text), false);
  const query = parameters(link.url);
  const publicPath = `/api/public/shares/${share.id}?${query}`;
  for (const credential of [
    undefined,
    'doorknob-session=invalid',
    foreign.cookie
  ]) {
    const result = await request(publicPath, 'GET', credential);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { reflection, text: share.text });
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  }
  assert.equal(
    (await request(`/api/shares/${share.id}`, 'GET', foreign.cookie)).status,
    404
  );
  assert.deepEqual(
    await (await request(`/api/shares/${share.id}`, 'GET', cookie)).json(),
    share
  );
  const head = await request(publicPath, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const expired = createShareLink(share.id, now - 604800);
  for (const broken of [
    `/api/public/shares/${share.id}?${parameters(expired.url)}`,
    `/api/public/shares/${share.id}`,
    publicPath + '&expires=' + query.get('expires'),
    publicPath + '&sig=' + query.get('sig'),
    publicPath.replace(share.id, randomUUID()),
    `/api/public/shares/${share.id}?expires=invalid&sig=invalid`,
    `/api/public/shares/${share.id}?expires=${now}&sig=${query.get('sig')}`
  ]) {
    const invalid = await request(broken);
    assert.equal(invalid.status, 404);
    assert.deepEqual(await invalid.json(), {
      error: { code: 'SHARE_NOT_FOUND', message: 'Share not found.' }
    });
    assert.equal(invalid.headers.get('set-cookie'), null);
    assert.equal(invalid.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
});

test('production API signing failures remain generic and never return a link or issue cookies', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    SESSION_SECRET: 'fictional-valid-session-secret-at-least-32-bytes'
  });
  const { share, cookie } = await create();
  Object.assign(process.env, { NODE_ENV: 'production', SHARE_LINK_SECRET: '' });
  const response = await request(
    `/api/shares/${share.id}/link`,
    'POST',
    cookie
  );
  // Session remains valid; the missing sharing key alone fails closed.
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
  assert.equal(response.headers.get('set-cookie'), null);
});
