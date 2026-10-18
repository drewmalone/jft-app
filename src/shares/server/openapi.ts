import 'server-only';
import { createRoute, type RouteConfig, z } from '@hono/zod-openapi';
import type { HeadersObject } from 'openapi3-ts/oas31';
import type { ApiErrorCode } from '../errors';
import {
  createShareSchema,
  shareSchema,
  MAX_SHARE_TEXT_LENGTH
} from '../model';
import {
  apiFailures,
  MAX_SHARE_REQUEST_BYTES,
  SESSION_CHALLENGE
} from './http';

import { anonymousSession, sameOrigin, jsonBody } from './middleware';

const share = shareSchema.openapi('Share', { additionalProperties: false });

const privateHeader = {
  description: 'Private responses are never cached.',
  required: true,
  schema: { type: 'string' as const, enum: ['private, no-store'] }
};
const cookieHeader = {
  description:
    'Issued only for a new anonymous session. HttpOnly, SameSite=Lax, path /, 30-day Max-Age; Secure in production. No rolling renewal.',
  schema: { type: 'string' as const }
};
const privateHeaders = {
  'Cache-Control': privateHeader,
  'Set-Cookie': cookieHeader
};
const sessionSecurity: Record<string, string[]>[] = [
  { AnonymousSession: [] },
  {}
];
function failed(
  codes: [ApiErrorCode, ...ApiErrorCode[]],
  extraHeaders: HeadersObject = {}
) {
  return {
    description: codes
      .map((code) => `${code}: ${apiFailures[code].message}`)
      .join(' '),
    headers: { ...privateHeaders, ...extraHeaders },
    content: {
      'application/json': {
        schema: z.object({
          error: z.object({ code: z.enum(codes), message: z.string() })
        })
      }
    }
  };
}
const commonFailures = {
  401: failed(['INVALID_SESSION'], {
    'WWW-Authenticate': {
      required: true,
      schema: { type: 'string' as const, enum: [SESSION_CHALLENGE] },
      description:
        'Private DoorknobSession scheme; send credentials via the session cookie, not an Authorization header.'
    }
  }),
  500: failed(['INTERNAL_ERROR'])
};
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

/** Declared methods for the collection resource, reused by OPTIONS and 405 responses. */
export const collectionAllow = 'GET, HEAD, POST, OPTIONS';
/** Declared methods for an individual private share. */
export const detailAllow = 'GET, HEAD, OPTIONS';

/** Collection read contract; history is private and newest first, with [] for no shares. */
export const listSharesRoute = createRoute({
  middleware: [anonymousSession] as const,
  method: 'get',
  path: '/shares',
  operationId: 'listShares',
  tags: ['Shares'],
  summary: 'List this anonymous owner’s private shares',
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
export const createShareRoute = createRoute({
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

/** Detail contract; nonexistent records and ownership mismatches intentionally share a 404. */
export const readShareRoute = createRoute({
  middleware: [anonymousSession] as const,
  method: 'get',
  path: '/shares/{id}',
  operationId: 'readShare',
  tags: ['Shares'],
  summary: 'Read one private share',
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

function headRoute(route: RouteConfig) {
  const { middleware: _middleware, ...contract } = route;
  void _middleware;
  return createRoute({
    ...contract,
    method: 'head',
    operationId: `${route.operationId}Head`,
    summary: `${route.summary} (headers only)`,
    responses: Object.fromEntries(
      Object.entries(route.responses).map(([status, response]) => {
        if ('$ref' in response) return [status, response];
        const { content: _content, ...headersOnly } = response;
        void _content;
        return [status, headersOnly];
      })
    )
  });
}

/** HEAD contracts inherit GET authorization and headers; Hono removes the body. */
export const headRoutes = [
  headRoute(listSharesRoute),
  headRoute(readShareRoute)
];

function optionsRoute(path: string, allow: string, operationId: string) {
  return createRoute({
    method: 'options',
    path,
    operationId,
    tags: ['Shares'],
    summary: 'Discover supported HTTP methods',
    description:
      'No session required or issued. No CORS permission is granted.',
    security: [],
    responses: {
      204: {
        description: 'No body; Allow advertises supported methods.',
        headers: {
          'Cache-Control': privateHeader,
          Allow: { required: true, schema: { type: 'string', enum: [allow] } }
        }
      }
    }
  });
}

/** Collection method discovery; used for both dispatch and documentation. */
export const collectionOptionsRoute = optionsRoute(
  '/shares',
  collectionAllow,
  'sharesOptions'
);
/** Detail method discovery, independent of whether a record exists. */
export const detailOptionsRoute = createRoute({
  ...optionsRoute('/shares/{id}', detailAllow, 'shareOptions'),
  request: { params: idParams }
});

/** Configuration for the generated OpenAPI 3.1 document; contains no live share/session data. */
export const openApiConfiguration = {
  openapi: '3.1.0' as const,
  info: {
    title: 'Doorknob private share BFF',
    version: '0.2.0',
    description:
      'Local-development process-memory persistence. Restarts erase shares; serverless instances/replicas do not share data. No public sharing links or login.'
  },
  tags: [
    {
      name: 'Shares',
      description:
        'Private resources scoped to a signed anonymous session cookie.'
    }
  ]
};
