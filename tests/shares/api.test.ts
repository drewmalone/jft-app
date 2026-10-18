import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../src/app/api/shares/route';
import { GET as getDetail } from '../../src/app/api/shares/[id]/route';
import { reflection } from '../../src/shares/model';
import { shareRepository } from '../../src/shares/server/repository';

function request(method = 'GET', cookie?: string, body?: unknown) {
  return new NextRequest('http://localhost/api/shares', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}
function cookieFrom(response: Response) {
  return response.headers.get('set-cookie')!.split(';')[0];
}
async function session() {
  return cookieFrom(await GET(request()));
}
async function detail(id: string, cookie?: string) {
  return getDetail(request('GET', cookie), { params: Promise.resolve({ id }) });
}

test('creates validated shares with server metadata and retrieves them across requests', async () => {
  const before = Date.now();
  const response = await POST(
    request('POST', undefined, { text: '  A fictional thought.  ' })
  );
  assert.equal(response.status, 201);
  const share = await response.json();
  const cookie = cookieFrom(response);
  assert.match(cookie, /^doorknob-session=/);
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/i);
  assert.match(response.headers.get('set-cookie')!, /SameSite=lax/i);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(share.id, /^[0-9a-f-]{36}$/);
  assert.ok(
    Date.parse(share.createdAt) >= before &&
      Date.parse(share.createdAt) <= Date.now()
  );
  assert.equal(share.text, 'A fictional thought.');
  assert.equal(share.kind, 'text');
  assert.deepEqual(share.reflection, reflection);
  assert.equal('ownerId' in share, false);
  assert.deepEqual(await (await detail(share.id, cookie)).json(), share);
  const second = await (
    await POST(request('POST', cookie, { text: 'Another fictional thought.' }))
  ).json();
  assert.notEqual(second.id, share.id);
  assert.deepEqual(await (await GET(request('GET', cookie))).json(), [
    second,
    share
  ]);
});

test('rejects empty input, malformed JSON, wrong types and authoritative client fields', async () => {
  for (const body of [
    { text: '' },
    { text: ' \n ' },
    {},
    null,
    { text: 42 },
    { text: 'ok', ownerId: randomUUID() },
    { text: 'ok', id: randomUUID() },
    { text: 'ok', createdAt: '2025-01-01T00:00:00Z' },
    { text: 'ok', reflection }
  ]) {
    const response = await POST(request('POST', undefined, body));
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error.message, 'string');
  }
  const malformed = new NextRequest('http://localhost/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  });
  assert.equal((await POST(malformed)).status, 400);
  const wrongType = new NextRequest('http://localhost/api/shares', {
    method: 'POST',
    body: 'text'
  });
  assert.equal((await POST(wrongType)).status, 415);
});

test('returns 404 for nonexistent and other owners shares; isolates anonymous sessions', async () => {
  const first = await session();
  const second = await session();
  assert.notEqual(first, second);
  const created = await (
    await POST(request('POST', first, { text: 'Private fictional thought.' }))
  ).json();
  assert.deepEqual(await (await GET(request('GET', second))).json(), []);
  const missing = await detail(randomUUID(), first);
  const otherOwner = await detail(created.id, second);
  assert.equal(missing.status, 404);
  assert.equal(otherOwner.status, 404);
  assert.deepEqual(await otherOwner.json(), await missing.json());
  assert.equal((await detail(created.id)).status, 404);
});

test('rejects forged, unsigned, empty, malformed and expired session credentials', async () => {
  const valid = await session();
  const credential = valid.split('=')[1];
  const [owner, expires, signature] = credential.split('.');
  for (const forged of [
    '',
    randomUUID(),
    'garbage',
    `${randomUUID()}.${expires}.${signature}`,
    `${owner}.${expires}.${signature.slice(0, -1)}!`,
    `${owner}.1.${signature}`,
    `${owner}.${expires}.${signature}.extra`
  ]) {
    const cookie = `doorknob-session=${forged}`;
    assert.equal((await GET(request('GET', cookie))).status, 401);
    assert.equal(
      (await POST(request('POST', cookie, { text: 'Fictional thought.' })))
        .status,
      401
    );
    assert.equal((await detail(randomUUID(), cookie)).status, 401);
  }
});

test('rejects cross-origin writes', async () => {
  const req = new NextRequest('http://localhost/api/shares', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://elsewhere.example'
    },
    body: JSON.stringify({ text: 'Fictional thought.' })
  });
  assert.equal((await POST(req)).status, 403);
});

test('repository enforces ownership and returns independent snapshots', async () => {
  const owner = randomUUID();
  const other = randomUUID();
  const created = await shareRepository.create(owner, 'Fictional thought.');
  created.reflection.title = 'Changed';
  assert.equal(
    (await shareRepository.findByOwner(created.id, owner))?.reflection.title,
    reflection.title
  );
  assert.equal(await shareRepository.findByOwner(created.id, other), null);
  assert.deepEqual(await shareRepository.listByOwner(other), []);
});

test('production cookies are Secure and an authentic expired signature is rejected', async (context) => {
  const secret = 'fictional-unit-test-secret-at-least-32-bytes';
  context.mock.property(process, 'env', {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: secret
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie')!, /; Secure/i);
  assert.match(response.headers.get('set-cookie')!, /Max-Age=2592000/i);
  const payload = `${randomUUID()}.${Math.floor(Date.now() / 1000) - 1}`;
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  assert.equal(
    (await GET(request('GET', `doorknob-session=${payload}.${signature}`)))
      .status,
    401
  );
  delete process.env.SESSION_SECRET;
  assert.equal((await GET(request())).status, 500);
  process.env.SESSION_SECRET = 'too-short';
  assert.equal((await GET(request())).status, 500);
});

test('accepts same-origin requests when the listening hostname differs from Host', async () => {
  const req = new NextRequest('http://0.0.0.0:3100/api/shares', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: '127.0.0.1:3100',
      origin: 'http://127.0.0.1:3100'
    },
    body: JSON.stringify({ text: 'Fictional browser-facing origin.' })
  });
  assert.equal((await POST(req)).status, 201);
});

test('validates signed credential fields before using the typed session', async (context) => {
  const secret = 'fictional-parser-test-secret-at-least-32-bytes';
  context.mock.property(process, 'env', {
    ...process.env,
    SESSION_SECRET: secret
  });
  const ownerId = randomUUID();
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  function sign(expiry: string) {
    const payload = `${ownerId}.${expiry}`;
    const digest = createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');
    return `${payload}.${digest}`;
  }
  const valid = await GET(request('GET', `doorknob-session=${sign(expires)}`));
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get('set-cookie'), null);

  // Even correctly signed input must satisfy the credential schema.
  for (const expiry of [
    '',
    '0',
    '-1',
    'NaN',
    'Infinity',
    '1.5',
    '1e10',
    '0x123',
    '9007199254740992',
    `0${expires}`,
    `+${expires}`
  ]) {
    assert.equal(
      (await GET(request('GET', `doorknob-session=${sign(expiry)}`))).status,
      401
    );
  }

  const credential = sign(expires);
  const digest = credential.split('.')[2];
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const lastCharacter = alphabet.indexOf(digest.at(-1)!);
  const noncanonical = digest.slice(0, -1) + alphabet[lastCharacter + 1];
  // Node's decoder tolerates unused trailing bits; the cookie parser must not.
  assert.deepEqual(
    Buffer.from(noncanonical, 'base64url'),
    Buffer.from(digest, 'base64url')
  );
  for (const supplied of [
    digest.slice(1),
    digest + 'A',
    '!'.repeat(43),
    'A'.repeat(43),
    noncanonical
  ]) {
    assert.equal(
      (
        await GET(
          request('GET', `doorknob-session=${ownerId}.${expires}.${supplied}`)
        )
      ).status,
      401
    );
  }
});
