import 'server-only';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { shareSchema } from '../model';
import { shareRepository } from './repository';
import { error, apiFailures } from './http';
import type { SessionEnvironment } from './middleware';
import {
  share,
  privateHeaders,
  sessionSecurity,
  commonFailures,
  failed,
  headRoute,
  optionsRoute
} from './openapi';
import { anonymousSession } from './middleware';

/** Supported methods for a private share. */
export const detailAllow = 'GET, HEAD, OPTIONS';

const idParams = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: 'id', in: 'path' },
      description:
        'Share ID selects a record but does not authorize access. Non-UUID strings also return 404.'
    })
});

/** Detail contract; nonexistent records and ownership mismatches intentionally share a 404. */
const readShareRoute = createRoute({
  middleware: [anonymousSession] as const,
  method: 'get',
  path: '/shares/{id}',
  operationId: 'readShare',
  tags: ['Shares'],
  summary: 'Read one private share',
  description:
    'Requires the owning session. Missing records and records owned by another session both return 404.',
  security: sessionSecurity,
  request: { params: idParams },
  responses: {
    200: {
      description:
        'The owner-visible saved share and original reading snapshot.',
      headers: privateHeaders,
      content: { 'application/json': { schema: share } }
    },
    404: failed(['SHARE_NOT_FOUND']),
    ...commonFailures
  }
});

/**
 * Registers owner-checked detail contracts and handlers.
 * @param app - BFF with shared validation/error handling and the /api base path.
 * @returns Nothing; mutates the app and its OpenAPI registry.
 */
export function registerDetail(app: OpenAPIHono<SessionEnvironment>) {
  app.openapi(readShareRoute, async (c) => {
    const { id } = c.req.valid('param');
    const share = await shareRepository.findByOwner(id, c.get('ownerId'));
    if (!share)
      return c.json(
        {
          error: {
            code: 'SHARE_NOT_FOUND' as const,
            message: apiFailures.SHARE_NOT_FOUND.message
          }
        },
        404
      );
    return c.json(shareSchema.parse(share), 200);
  });
  const options = createRoute({
    ...optionsRoute('/shares/{id}', detailAllow, 'shareOptions'),
    request: { params: idParams }
  });
  app.openapi(options, (c) => c.body(null, 204, { Allow: detailAllow }));
  app.openAPIRegistry.registerPath(headRoute(readShareRoute));
  app.all('/shares/:id', () =>
    error('METHOD_NOT_ALLOWED', { Allow: detailAllow })
  );
}
