import 'server-only';
import { createRoute, type RouteConfig, z } from '@hono/zod-openapi';
import type { HeadersObject } from 'openapi3-ts/oas31';
import type { ApiErrorCode } from '../../http/errors';
import { apiErrorSchema } from '../../http/errors';
import { apiFailures } from './errors';

export const browserOriginHeaders = z.object({
  origin: z
    .string()
    .describe(
      'Exact public scheme and authority of this browser API, for example https://preview.example. Required browser request policy; not authentication.'
    )
});

const apiError = apiErrorSchema.clone().openapi('ApiError');

export const retryAfterHeaders = {
  'Retry-After': {
    required: true,
    description: 'Seconds to wait before retrying the shared quota window.',
    schema: { type: 'string' as const, pattern: '^[1-9][0-9]*$' }
  }
};

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

export const privateHeaders = {
  'Cache-Control': privateHeader,
  'Set-Cookie': cookieHeader
};

export const sessionSecurity: Record<string, string[]>[] = [
  { AnonymousSession: [] },
  {}
];
/** Restrict each HTTP error response to its allowed codes. */
export function failed(
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
        schema: apiError.extend({
          error: apiError.shape.error.extend({ code: z.enum(codes) })
        })
      }
    }
  };
}

export const commonFailures = { 500: failed(['INTERNAL_ERROR']) };
/** HEAD inherits GET checks and headers; document it without response bodies. */
export function headRoute(route: RouteConfig) {
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

export function optionsRoute(
  path: string,
  allow: string,
  operationId: string,
  tag: 'Shares' | 'Transcription' | 'Readings' | 'Session' = 'Shares'
) {
  return createRoute({
    method: 'options',
    path,
    operationId,
    tags: [tag],
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

export const openApiConfiguration = {
  openapi: '3.1.0' as const,
  info: {
    title: 'Doorknob API',
    version: '0.3.0',
    contact: { url: 'https://github.com/drewmalone/jft-app/issues' },
    description:
      'Explicit DynamoDB persistence or disposable process memory, with date-keyed daily readings. Owner-scoped private shares and expiring UUID public reading links. No login or immediate link revocation.'
  },
  servers: [{ url: '/', description: 'Same origin as the application.' }],
  tags: [
    {
      name: 'Security',
      description: 'Bounded CSP reports discarded without retention.'
    },
    {
      name: 'Session',
      description:
        'Signed anonymous browser session preparation; independent of storage and providers.'
    },
    {
      name: 'Readings',
      description:
        'Date-keyed Just for Today text, selected by reader timezone and cached per process.'
    },
    {
      name: 'Transcription',
      description:
        'Explicit live microphone sessions with short-lived provider credentials; no audio storage.'
    },
    {
      name: 'Shares',
      description:
        'Private resources scoped to a signed anonymous session cookie, and public reads authorized by expiring bearer UUIDs.'
    }
  ]
};
