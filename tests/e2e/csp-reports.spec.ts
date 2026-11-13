import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { expect, test } from './fixtures/test';

test('stalled streamed CSP report receives a bounded timeout without establishing a session', async ({
  baseURL
}) => {
  const result = await new Promise<{ status?: number; cookie?: string[] }>(
    (resolve, reject) => {
      const request = httpsRequest(
        new URL('/api/csp-report', baseURL),
        {
          method: 'POST',
          // Trust only this run's ephemeral certificate; normal hostname verification remains enabled.
          ca: readFileSync(resolvePath('.tmp/playwright-tls-cert.pem')),
          headers: { 'content-type': 'application/csp-report' }
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve({
              status: response.statusCode,
              cookie: response.headers['set-cookie']
            });
            request.destroy();
          });
        }
      );
      request.setTimeout(10000, () =>
        request.destroy(
          new Error('Synthetic CSP timeout response was not bounded')
        )
      );
      request.on('error', reject);
      request.write('{'); // Keep the body open; the application must expire the read.
    }
  );
  expect(result.status).toBe(408);
  expect(result.cookie).toBeUndefined();
});

test('the CSP test client still rejects an untrusted TLS hostname', async ({
  baseURL
}) => {
  const attempt = new Promise<void>((resolve, reject) => {
    const request = httpsRequest(
      new URL('/api/csp-report', baseURL),
      {
        ca: readFileSync(resolvePath('.tmp/playwright-tls-cert.pem')),
        servername: 'untrusted.invalid'
      },
      (response) => {
        response.resume();
        request.destroy();
        resolve();
      }
    );
    request.on('error', reject);
    request.end();
  });
  await expect(attempt).rejects.toHaveProperty(
    'code',
    'ERR_TLS_CERT_ALTNAME_INVALID'
  );
});
