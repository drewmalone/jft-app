import 'server-only';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  shareSchema,
  createShareSchema,
  MAX_SHARE_TEXT_LENGTH
} from '../model';
import { shareRepository } from './repository';
import { error, MAX_SHARE_REQUEST_BYTES } from './http';
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
import { anonymousSession, sameOrigin, jsonBody } from './middleware';

/** Supported collection methods, shared by discovery and rejected-method responses. */
export const collectionAllow = 'GET, HEAD, POST, OPTIONS';

/** Collection read contract; history is private and newest first, with [] for no shares. */
const listSharesRoute = createRoute({
  middleware: [anonymousSession] as const,
  method: 'get',
  path: '/shares',
  operationId: 'listShares',
  tags: ['Shares'],
  summary: 'List this anonymous owner’s private shares',
  description:
    'Returns only the current session’s shares, newest first. An empty history is an empty array.',
  security: sessionSecurity,
  responses: {
    200: {
      description:
        'Newest timestamp first; equal timestamps use newest insertion first. No pagination or owner query filter.',
      headers: privateHeaders,
      content: { 'application/json': { schema: z.array(share) } }
    },
    ...commonFailures
  }
});

/** Creation contract; runtime input validation and OpenAPI generation use the same Zod object. */
const createShareRoute = createRoute({
  middleware: [anonymousSession, sameOrigin, jsonBody] as const,
  method: 'post',
  path: '/shares',
  operationId: 'createShare',
  tags: ['Shares'],
  summary: 'Save a private text share',
  description:
    'POST is not idempotent. A supplied Origin must match Host/protocol.',
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      description: `Only text is accepted: at most ${MAX_SHARE_TEXT_LENGTH} Unicode code points before trimming, then at least one non-whitespace character. Raw JSON is limited to ${MAX_SHARE_REQUEST_BYTES} bytes. JSON media types are case-insensitive; valid parameters are accepted.`,
      content: {
        'application/json': {
          schema: createShareSchema.openapi('CreateShare', {
            example: { text: 'A fictional thought.' }
          })
        }
      }
    }
  },
  responses: {
    201: {
      description:
        'Server-confirmed record with generated ID/time and reading snapshot; ownerId is omitted.',
      headers: {
        ...privateHeaders,
        Location: {
          required: true,
          description: 'Relative canonical detail URL for the created share.',
          schema: { type: 'string' as const },
          example: '/api/shares/95eff0e1-bca7-4fd1-83d2-42ba330aab22'
        }
      },
      content: { 'application/json': { schema: share } }
    },
    400: failed(['INVALID_JSON', 'INVALID_SHARE']),
    403: failed(['CROSS_ORIGIN_REQUEST']),
    413: failed(['PAYLOAD_TOO_LARGE']),
    415: failed(['UNSUPPORTED_MEDIA_TYPE']),
    ...commonFailures
  }
});

/**
 * Registers collection contracts and handlers, including bodyless method discovery.
 * @param app - BFF with shared validation/error handling and the /api base path.
 * @returns Nothing; mutates the app and its OpenAPI registry.
 */
export function registerCollection(app: OpenAPIHono<SessionEnvironment>) {
  app.openapi(listSharesRoute, async (c) => {
    const shares = await shareRepository.listByOwner(c.get('ownerId'));
    return c.json(
      shares.map((share) => shareSchema.parse(share)),
      200
    );
  });
  app.openapi(createShareRoute, async (c) => {
    const { text } = c.req.valid('json');
    const share = await shareRepository.create(c.get('ownerId'), text);
    c.header('Location', `/api/shares/${share.id}`);
    return c.json(shareSchema.parse(share), 201);
  });
  app.openapi(optionsRoute('/shares', collectionAllow, 'sharesOptions'), (c) =>
    c.body(null, 204, { Allow: collectionAllow })
  );
  app.openAPIRegistry.registerPath(headRoute(listSharesRoute));
  app.all('/shares', () =>
    error('METHOD_NOT_ALLOWED', { Allow: collectionAllow })
  );
}
