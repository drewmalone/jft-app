import { SubmissionConflict } from '../../storage/submission';
import { share } from '../schemas';
import { retryAfterHeaders } from '../../../../server/http/openapi';
import { enforceQuota } from '../../../../server/http/enforce-quota';
import { getCookie } from 'hono/cookie';
import { createShareForReading } from '../../application/create-share';
import {
  readingTimeZone,
  READING_TIME_ZONE_COOKIE
} from '../../../../readings/calendar';
import { errorBody } from '../../../../server/http/errors';
import 'server-only';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { shareSchema } from '../../../model';
import type { SessionEnvironment } from '../../../../server/http/middleware';
import {
  privateHeaders,
  sessionSecurity,
  commonFailures,
  failed
} from '../../../../server/http/openapi';
import { createShareSchema, MAX_SHARE_TEXT_LENGTH } from '../../../model';
import { MAX_SHARE_REQUEST_BYTES } from '../../../../server/http/errors';
import {
  anonymousSession,
  sameOrigin,
  jsonBody
} from '../../../../server/http/middleware';

export const createShareRoute = createRoute({
  middleware: [sameOrigin, anonymousSession, jsonBody] as const,
  method: 'post',
  path: '/shares',
  operationId: 'createShare',
  tags: ['Shares'],
  summary: 'Save a private text share',
  description:
    'An optional Idempotency-Key UUID makes retries owner-scoped and returns the original share. A supplied Origin must match Host/protocol; origin rejection precedes session handling.',
  security: sessionSecurity,
  request: {
    headers: z.object({
      'idempotency-key': z
        .uuid({ version: 'v4' })
        .optional()
        .describe(
          'Reuse for retries of one unchanged submission; choose a new UUID for an intentional new save.'
        )
    }),
    body: {
      required: true,
      description: `Text plus an optional ISO readingDate is accepted: at most ${MAX_SHARE_TEXT_LENGTH} Unicode code points before trimming, then at least one non-whitespace character. Raw JSON is limited to ${MAX_SHARE_REQUEST_BYTES} bytes. JSON media types are case-insensitive; valid parameters are accepted.`,
      content: {
        'application/json': {
          schema: createShareSchema.clone().openapi('CreateShare', {
            example: { text: 'A fictional thought.' }
          })
        }
      }
    }
  },
  responses: {
    429: failed(['RATE_LIMITED'], retryAfterHeaders),
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
    400: failed(['INVALID_JSON', 'INVALID_SHARE', 'INVALID_IDEMPOTENCY_KEY']),
    403: failed(['CROSS_ORIGIN_REQUEST']),
    413: failed(['PAYLOAD_TOO_LARGE']),
    415: failed(['UNSUPPORTED_MEDIA_TYPE']),
    409: failed(['READING_CHANGED', 'IDEMPOTENCY_CONFLICT']),
    503: failed(['READING_UNAVAILABLE', 'INTERNAL_ERROR']),
    ...commonFailures
  }
});

/** Ownership comes from the session; client input selects a date, never the reading text. */
export const createShare: RouteHandler<
  typeof createShareRoute,
  SessionEnvironment
> = async (c) => {
  try {
    const result = await createShareForReading(
      c.get('ownerId'),
      c.req.valid('json'),
      readingTimeZone(getCookie(c, READING_TIME_ZONE_COOKIE)),
      undefined,
      undefined,
      c.req.valid('header')['idempotency-key'],
      () => enforceQuota('create', c.get('ownerId'))
    );
    if (result.error === 'READING_UNAVAILABLE')
      return c.json(errorBody(result.error), 503);
    if (result.error === 'READING_CHANGED')
      return c.json(errorBody(result.error), 409);
    const { share } = result;
    c.header('Location', `/api/shares/${share.id}`);
    return c.json(shareSchema.parse(share), 201);
  } catch (cause) {
    if (cause instanceof SubmissionConflict)
      return c.json(errorBody('IDEMPOTENCY_CONFLICT'), 409);
    throw cause;
  }
};
