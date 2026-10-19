import 'server-only';
import {
  createRoute,
  type RouteHandler,
  type RouteHook,
  z
} from '@hono/zod-openapi';
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
    'Verifies the ID and HMAC before reading storage, then enforces seven days from the server-stored creation time. Invalid, expired and missing links all return the same 404. Never creates or requires a session.',
  security: [],
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
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
  const sig = c.req.queries('sig') ?? [];
  const share = await readPublicShare(
    c.req.valid('param').id,
    sig.length === 1 ? sig[0] : undefined
  );
  return share ? c.json(share, 200) : c.json(errorBody('SHARE_NOT_FOUND'), 404);
};

/** Hono's operation-specific validation hook keeps malformed public credentials indistinguishable. */
export const publicShareValidation = ((result, c) => {
  if (!result.success) return c.json(errorBody('SHARE_NOT_FOUND'), 404);
}) satisfies RouteHook<typeof readPublicShareRoute, SessionEnvironment>;
