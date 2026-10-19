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

test('versioned HMAC binds the exact ID; URLs contain only a signature', (t) => {
  t.mock.property(process, 'env', { ...process.env, SHARE_LINK_SECRET: key });
  const id = randomUUID();
  const { url } = createShareLink(id);
  const query = parameters(url);
  assert.deepEqual([...query.keys()], ['sig']);
  const sig = query.get('sig')!;
  assert.equal(
    sig,
    createHmac('sha256', key).update(`share:v2\n${id}`).digest('base64url')
  );
  assert.equal(verifyShareLink(id, sig), true);
  assert.equal(verifyShareLink(randomUUID(), sig), false);
  assert.equal(
    verifyShareLink(id, `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`),
    false
  );
  for (const bad of [
    undefined,
    null,
    [],
    [sig, sig],
    '',
    sig + '=',
    sig.slice(1),
    '!'.repeat(43),
    'A'.repeat(44)
  ])
    assert.equal(verifyShareLink(id, bad), false);
  assert.equal(verifyShareLink('invalid', sig), false);
  assert.throws(() => createShareLink('invalid'));
  const otherPurpose = createHmac('sha256', key)
    .update(`session:v2\n${id}`)
    .digest('base64url');
  assert.equal(verifyShareLink(id, otherPurpose), false);
  const legacy = createHmac('sha256', key)
    .update(`share:v1\n${id}\n${now + 604800}`)
    .digest('base64url');
  assert.equal(verifyShareLink(id, legacy), false);
});

test('separate process-stable development key, and fail-closed production configuration', (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    NODE_ENV: 'development',
    SESSION_SECRET: undefined,
    SHARE_LINK_SECRET: undefined
  });
  const id = randomUUID();
  assert.deepEqual(createShareLink(id), createShareLink(id));
  Object.assign(process.env, { NODE_ENV: 'production' });
  for (const value of [undefined, '', 'short']) {
    if (value === undefined) delete process.env.SHARE_LINK_SECRET;
    else process.env.SHARE_LINK_SECRET = value;
    assert.throws(() => createShareLink(id));
    assert.throws(() => verifyShareLink(id, 'A'.repeat(43)));
  }
  process.env.SHARE_LINK_SECRET = key;
  process.env.SESSION_SECRET = key;
  assert.throws(() => createShareLink(id));
  process.env.SESSION_SECRET = 'a-different-fictional-session-secret';
  assert.ok(createShareLink(id).url);
});

test('public service authenticates before lookup and enforces seven days from stored creation time', async (t) => {
  t.mock.property(process, 'env', { ...process.env, SHARE_LINK_SECRET: key });
  t.mock.method(Date, 'now', () => now * 1000);
  const store = new InMemoryShareRepository();
  const saved = await store.create(
    randomUUID(),
    'Fictional public service text.'
  );
  const sig = parameters(saved.shareUrl).get('sig');
  const lookup = t.mock.method(store, 'findById');
  assert.equal(
    await readPublicShare(saved.id, 'invalid', store, now * 1000),
    null
  );
  assert.equal(lookup.mock.callCount(), 0);
  assert.deepEqual(await readPublicShare(saved.id, sig, store, now * 1000), {
    reflection,
    text: saved.text
  });
  const boundary = Date.parse(saved.createdAt) + 7 * 24 * 60 * 60 * 1000;
  assert.ok(await readPublicShare(saved.id, sig, store, boundary - 1));
  assert.equal(await readPublicShare(saved.id, sig, store, boundary), null);
  assert.equal(await readPublicShare(saved.id, sig, store, boundary + 1), null);
  assert.equal(
    await readPublicShare(saved.id, sig, store, now * 1000 - 1),
    null
  );
  assert.equal(await readPublicShare(saved.id, sig, store, NaN), null);
  assert.equal(
    await readPublicShare(
      saved.id,
      sig,
      new InMemoryShareRepository(),
      now * 1000
    ),
    null
  );
  const detached = await store.findById(saved.id);
  detached!.createdAt = new Date(boundary).toISOString();
  assert.equal(await readPublicShare(saved.id, sig, store, boundary), null);
});

test('saving creates one reusable owner-only URL; public reads have no session side effects', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    SHARE_LINK_SECRET: key
  });
  let currentTime = now * 1000;
  t.mock.method(Date, 'now', () => currentTime);
  const { share, cookie } = await create();
  const foreign = await create();
  const link = { url: share.shareUrl };
  const query = parameters(link.url);
  assert.deepEqual([...query.keys()], ['sig']);
  assert.equal(link.url.includes(key), false);
  assert.equal(link.url.includes(share.text), false);
  const listed = await (await request('/api/shares', 'GET', cookie)).json();
  assert.equal(listed[0].shareUrl, share.shareUrl);
  const crossOrigin = await dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { origin: 'https://elsewhere.example' }
    })
  );
  assert.equal(crossOrigin.status, 403);
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
  for (const broken of [
    `/api/public/shares/${share.id}`,
    publicPath + '&sig=' + query.get('sig'),
    publicPath.replace(share.id, randomUUID()),
    `/api/public/shares/${share.id}?sig=invalid`
  ]) {
    const invalid = await request(broken);
    assert.equal(invalid.status, 404);
    assert.deepEqual(await invalid.json(), {
      error: { code: 'SHARE_NOT_FOUND', message: 'Share not found.' }
    });
    assert.equal(invalid.headers.get('set-cookie'), null);
    assert.equal(invalid.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  currentTime = (now + 604800) * 1000;
  for (const path of [
    publicPath,
    publicPath + '&expires=9999999999999999',
    publicPath + '&createdAt=2099-01-01'
  ]) {
    const expired = await request(path);
    assert.equal(expired.status, 404);
    assert.equal(expired.headers.get('set-cookie'), null);
  }
});

test('production API signing failures remain generic and never return a link or issue cookies', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    SESSION_SECRET: 'fictional-valid-session-secret-at-least-32-bytes'
  });
  Object.assign(process.env, { NODE_ENV: 'production', SHARE_LINK_SECRET: '' });
  const response = await dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'A fictional unsaved share.' })
    })
  );
  // A missing sharing key fails before storing the record.
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
  assert.equal(response.headers.get('set-cookie'), null);
});
