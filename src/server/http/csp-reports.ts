import 'server-only';
import { requestLimits } from '../../config/request-limits';
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { sameOrigin, type SessionEnvironment } from './middleware';
import { error } from './errors';
import {
  commonFailures,
  failed,
  optionsRoute,
  privateHeaders
} from './openapi';

/** Reports may contain bearer URLs. Count actual stream bytes without buffering, parsing or logging. */
const discardReport: MiddlewareHandler = async (c, next) => {
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    let size = 0;
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      // Cancellation may itself hang; do not wait for the sender's acknowledgement.
      void reader.cancel().catch(() => {});
    }, requestLimits.cspReportMs);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (expired) return error('REQUEST_TIMEOUT');
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          void reader.cancel().catch(() => {});
          return error('PAYLOAD_TOO_LARGE');
        }
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }
  await next();
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
        'Same-origin report-only CSP destination. Accepts at most 8192 actual body bytes within five seconds of opaque report data; discards all data without parsing, logging, issuing a cookie or contacting storage/providers. Browser developer tools retain violation diagnostics.',
      middleware: [sameOrigin, discardReport] as const,
      security: [],
      responses: {
        204: {
          description: 'Report discarded without retaining any data.',
          headers: privateHeaders
        },
        403: failed(['CROSS_ORIGIN_REQUEST']),
        408: failed(['REQUEST_TIMEOUT']),
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
