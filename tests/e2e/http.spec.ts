import { expect, test } from './fixtures/test';
import SwaggerParser from '@apidevtools/swagger-parser';

// Exercise actual Next.js exports and framework routing, not just app.fetch.
test('serves OpenAPI and honors resource HTTP methods, headers, and sessions', async ({
  request
}) => {
  const specification = await request.get('/api/openapi.json');
  expect(specification.status()).toBe(200);
  expect(specification.headers()['set-cookie']).toBeUndefined();
  const document = await specification.json();
  expect(document.openapi).toBe('3.1.0');
  await SwaggerParser.validate(document, { resolve: { external: false } });
  const created = await request.post('/api/shares', {
    headers: { 'Content-Type': 'Application/JSON; charset="UTF-8"' },
    data: JSON.stringify({ text: 'A fictional HTTP contract thought.' })
  });
  expect(created.status()).toBe(201);
  const share = await created.json();
  const ownerCookie = created.headers()['set-cookie'].split(';')[0];
  const location = `/api/shares/${share.id}`;
  expect(created.headers().location).toBe(location);
  expect(share.ownerId).toBeUndefined();
  expect((await request.get(location)).status()).toBe(200);
  for (const [path, allow] of [
    ['/api/shares', 'GET, HEAD, POST, OPTIONS'],
    [location, 'GET, HEAD, OPTIONS']
  ]) {
    const head = await request.head(path, { headers: { Cookie: ownerCookie } });
    expect(head.status()).toBe(200);
    expect(await head.body()).toHaveLength(0);
    expect(head.headers()['cache-control']).toBe('private, no-store');
    const options = await request.fetch(path, {
      method: 'OPTIONS',
      headers: { Cookie: 'doorknob-session=forged' }
    });
    expect(options.status()).toBe(204);
    expect(options.headers().allow).toBe(allow);
    expect(options.headers()['set-cookie']).toBeUndefined();
    expect(options.headers()['access-control-allow-origin']).toBeUndefined();
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const rejected = await request.fetch(path, { method });
      expect(rejected.status()).toBe(405);
      expect(rejected.headers().allow).toBe(allow);
      expect((await rejected.json()).error.code).toBe('METHOD_NOT_ALLOWED');
    }
    const invalid = await request.get(path, {
      headers: { Cookie: 'doorknob-session=forged' }
    });
    expect(invalid.status()).toBe(path === '/api/shares' ? 200 : 404);
    expect(invalid.headers()['set-cookie']).toBeDefined();
    expect(invalid.headers()['www-authenticate']).toBeUndefined();
  }
});

test('shared runtime preserves idempotency conflicts and private quota denials across Next bundles', async ({
  request
}) => {
  const key = crypto.randomUUID();
  const save = (text: string) =>
    request.post('/api/shares', {
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      data: JSON.stringify({ text })
    });
  const first = await save('Fictional shared-runtime contract.');
  const replay = await save('Fictional shared-runtime contract.');
  const conflict = await save('Changed fictional shared-runtime contract.');
  expect(first.status()).toBe(201);
  expect(replay.status()).toBe(201);
  expect((await replay.json()).id).toBe((await first.json()).id);
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
  // Fixture allowance is 120/minute. A test can straddle one boundary; 241 calls
  // must encounter a denial within the test's <60-second duration, without sleeps.
  let denied = false;
  for (let attempt = 0; attempt < 241; attempt++) {
    const response = await request.get('/api/shares');
    if (response.status() === 429) {
      expect((await response.json()).error.code).toBe('RATE_LIMITED');
      expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0);
      denied = true;
      break;
    }
    expect(response.status()).toBe(200);
  }
  expect(denied).toBe(true);
});
