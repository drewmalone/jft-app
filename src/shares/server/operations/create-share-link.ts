import 'server-only';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { shareLinkSchema } from '../../model';
import { shareRepository } from '../repository';
import { createShareLink } from '../share-links';
import {
  existingSession,
  sameOrigin,
  type SessionEnvironment
} from '../middleware';
import { privateHeaders, commonFailures, failed } from '../openapi';
import { errorBody } from '../http';
import { readShareRoute } from './read-share';

/** Owner-authorized, stateless signed-link creation contract. No body is required. */
export const createShareLinkRoute = createRoute({
  middleware: [sameOrigin, existingSession] as const,
  method: 'post',
  path: '/shares/{id}/link',
  operationId: 'createShareLink',
  tags: ['Shares'],
  summary: 'Intentionally generate an expiring sharing link',
  description:
    'Requires an existing owning session. Does not change stored content or persist tokens. The returned relative URL is a bearer capability; resolve it against the application origin. Never log it.',
  security: [{ AnonymousSession: [] }],
  request: { params: readShareRoute.request.params },
  responses: {
    200: {
      description:
        'Signed relative URL and absolute expiration in Unix seconds.',
      headers: privateHeaders,
      content: {
        'application/json': { schema: shareLinkSchema.openapi('ShareLink') }
      }
    },
    403: failed(['CROSS_ORIGIN_REQUEST']),
    404: failed(['SHARE_NOT_FOUND']),
    ...commonFailures
  }
});
/** Creates a capability only after owner-scoped lookup; signing failures become generic 500s. */
export const generateShareLink: RouteHandler<
  typeof createShareLinkRoute,
  SessionEnvironment
> = async (c) => {
  const { id } = c.req.valid('param');
  const stored = await shareRepository.findByOwner(id, c.get('ownerId'));
  if (!stored) return c.json(errorBody('SHARE_NOT_FOUND'), 404);
  return c.json(createShareLink(stored.id), 200);
};
