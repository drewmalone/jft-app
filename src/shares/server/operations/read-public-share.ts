import 'server-only';
import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import { publicShareSchema } from '../../model';
import { readPublicShare } from '../public-shares';
import { failed, privateHeaders } from '../openapi';
import { errorBody } from '../http';
import type { SessionEnvironment } from '../middleware';

/** Privacy headers on public content and unavailable responses; no session cookie is used. */
export const publicHeaders = {
  'Cache-Control': privateHeaders['Cache-Control'],
  'X-Robots-Tag': {
    required: true,
    description: 'Do not index or follow shared content.',
    schema: { type: 'string' as const, enum: ['noindex, nofollow'] }
  },
  'Referrer-Policy': {
    required: true,
    description: 'Do not forward bearer URLs.',
    schema: { type: 'string' as const, enum: ['no-referrer'] }
  }
};
const unavailable = { ...failed(['SHARE_NOT_FOUND']), headers: publicHeaders };
/** Public capability contract. Broad input schemas let all malformed credentials receive generic 404. */
export const readPublicShareRoute = createRoute({
  method: 'get',
  path: '/public/shares/{id}',
  operationId: 'readPublicShare',
  tags: ['Shares'],
  summary: 'Read a share using an expiring signed capability',
  description:
    'Verifies the ID, expiry and HMAC before reading storage. Invalid, expired and missing links all return the same 404. Never creates or requires a session.',
  security: [],
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      expires: z.string().optional().openapi({
        description:
          'Required canonical Unix expiration seconds. Missing, duplicate or malformed values return 404.'
      }),
      sig: z.string().optional().openapi({
        description:
          'Required canonical base64url HMAC-SHA256 signature. Treat as a credential; never log.'
      })
    })
  },
  responses: {
    200: {
      description:
        'Only the original reading and written thoughts; no owner or private metadata.',
      headers: publicHeaders,
      content: {
        'application/json': {
          schema: publicShareSchema.openapi('PublicShare', {
            additionalProperties: false
          })
        }
      }
    },
    404: unavailable,
    500: { ...failed(['INTERNAL_ERROR']), headers: publicHeaders }
  }
});
/** Reads only through the authorization service, rejecting duplicate credential parameters. */
export const getPublicShare: RouteHandler<
  typeof readPublicShareRoute,
  SessionEnvironment
> = async (c) => {
  const expires = c.req.queries('expires') ?? [];
  const sig = c.req.queries('sig') ?? [];
  const share = await readPublicShare(
    c.req.valid('param').id,
    expires.length === 1 ? expires[0] : undefined,
    sig.length === 1 ? sig[0] : undefined
  );
  return share ? c.json(share, 200) : c.json(errorBody('SHARE_NOT_FOUND'), 404);
};
