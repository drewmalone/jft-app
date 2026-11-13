import '@hono/zod-openapi';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatch, getOpenApiDocument } from '../../src/server/app';
import { securityHeaders } from '../../src/config/security-headers';

test('report-only CSP has a real same-origin destination and discards sensitive reports without logging', async (t) => {
  const logs = ['log', 'warn', 'error', 'info'].map((method) =>
    t.mock.method(console, method as 'log', () => {})
  );
  const policy = securityHeaders(false).find(
    (header) => header.key === 'Content-Security-Policy-Report-Only'
  )!.value;
  assert.match(policy, /report-uri \/api\/csp-report(?:;|$)/);
  const submit = (body: string, headers: HeadersInit = {}) =>
    dispatch(
      new Request('http://localhost/api/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report', ...headers },
        body
      })
    );
  for (const body of [
    JSON.stringify({
      'csp-report': {
        'document-uri': 'http://localhost/s/fictional-private-bearer',
        'script-sample': 'Fictional private words.'
      }
    }),
    'opaque invalid json',
    'x'.repeat(8192)
  ]) {
    const response = await submit(body);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  const oversized = await submit('x'.repeat(8193), { 'content-length': '1' });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get('set-cookie'), null);
  const foreign = await submit('{}', { origin: 'https://foreign.example' });
  assert.equal(foreign.status, 403);
  const get = await dispatch(new Request('http://localhost/api/csp-report'));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST, OPTIONS');
  const options = await dispatch(
    new Request('http://localhost/api/csp-report', { method: 'OPTIONS' })
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('allow'), 'POST, OPTIONS');
  assert.ok(getOpenApiDocument().paths?.['/api/csp-report']?.post);
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});
