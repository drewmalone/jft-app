import 'server-only';
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import {
  anonymousSession,
  exactSameOrigin,
  type ApiEnvironment
} from '../../server/http/middleware';
import {
  browserOriginHeaders,
  privateHeaders,
  commonFailures,
  failed,
  optionsRoute
} from '../../server/http/openapi';
import { error } from '../../server/http/errors';

const bootstrapRoute = createRoute({
  method: 'post',
  path: '/session',
  operationId: 'prepareAnonymousSession',
  tags: ['Session'],
  summary: 'Prepare the private browser session',
  description:
    'Requires exact same-origin Origin. Creates a signed anonymous cookie only when needed; never reads history, contacts providers, returns owner IDs, or renews a valid session.',
  middleware: [exactSameOrigin, anonymousSession] as const,
  security: [],
  request: { headers: browserOriginHeaders },
  responses: {
    200: {
      description: 'Session ready; ownership remains in the HttpOnly cookie.',
      headers: privateHeaders,
      content: {
        'application/json': {
          schema: z.strictObject({ ready: z.literal(true) })
        }
      }
    },
    403: failed(['CROSS_ORIGIN_REQUEST']),
    ...commonFailures
  }
});
export function registerSession(app: OpenAPIHono<ApiEnvironment>) {
  app.openapi(bootstrapRoute, (c) => c.json({ ready: true as const }, 200));
  app.openapi(
    optionsRoute('/session', 'POST, OPTIONS', 'sessionOptions', 'Session'),
    (c) => c.body(null, 204, { Allow: 'POST, OPTIONS' })
  );
  app.all('/session', () =>
    error('METHOD_NOT_ALLOWED', { Allow: 'POST, OPTIONS' })
  );
}
