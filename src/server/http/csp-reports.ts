import 'server-only';
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { sameOrigin, type SessionEnvironment } from './middleware';
import { error } from './errors';
import {
  commonFailures,
  failed,
  optionsRoute,
  privateHeaders
} from './openapi';

const limit = bodyLimit({
  maxSize: 8192,
  onError: () => error('PAYLOAD_TOO_LARGE')
});
/** Reports may contain bearer URLs. Bound actual bytes and discard without parsing or logging. */
const discardReport: MiddlewareHandler = async (c, next) => {
  const headers = new Headers(c.req.raw.headers);
  headers.delete('content-length');
  c.req.raw = new Request(c.req.raw, { headers });
  return limit(c, next);
};
export function registerCspReports(app: OpenAPIHono<SessionEnvironment>) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/csp-report',
      operationId: 'discardCspReport',
      tags: ['Security'],
      summary: 'Discard a browser CSP report safely',
      description:
        'Same-origin report-only CSP destination. Accepts at most 8192 actual body bytes of opaque report data; discards all data without parsing, logging, issuing a cookie or contacting storage/providers. Browser developer tools retain violation diagnostics.',
      middleware: [sameOrigin, discardReport] as const,
      security: [],
      responses: {
        204: {
          description: 'Report discarded without retaining any data.',
          headers: privateHeaders
        },
        403: failed(['CROSS_ORIGIN_REQUEST']),
        413: failed(['PAYLOAD_TOO_LARGE']),
        ...commonFailures
      }
    }),
    (c) => c.body(null, 204)
  );
  app.openapi(
    optionsRoute(
      '/csp-report',
      'POST, OPTIONS',
      'cspReportOptions',
      'Security'
    ),
    (c) => c.body(null, 204, { Allow: 'POST, OPTIONS' })
  );
  app.all('/csp-report', () =>
    error('METHOD_NOT_ALLOWED', { Allow: 'POST, OPTIONS' })
  );
}
