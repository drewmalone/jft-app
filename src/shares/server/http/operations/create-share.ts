import type { MiddlewareHandler } from 'hono';
import {
  cleanShareText,
  reportTranscriptionFailure
} from '../../cleanup-provider';
import { exactSameOrigin, existingSession } from '../middleware';

import { retryAfterHeaders } from '../openapi';
import { enforceQuota } from '../../auth/quotas';
import { getCookie } from 'hono/cookie';
import { createShareForReading } from '../../application/create-share';
import {
  readingTimeZone,
  READING_TIME_ZONE_COOKIE
} from '../../../../readings/calendar';
import { errorBody } from '../errors';
import 'server-only';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { shareSchema } from '../../../model';
import type { SessionEnvironment } from '../middleware';
import {
  share,
  privateHeaders,
  sessionSecurity,
  commonFailures,
  failed
} from '../openapi';
import { createShareSchema, MAX_SHARE_TEXT_LENGTH } from '../../../model';
import { MAX_SHARE_REQUEST_BYTES } from '../errors';
import { anonymousSession, sameOrigin, jsonBody } from '../middleware';

class SaveCleanupError extends Error {}

/** Paid cleanup retains the standalone cleanup operation's origin/session boundary. */
const tidySaveAccess: MiddlewareHandler<SessionEnvironment> = async (
  c,
  next
) => {
  const input = await c.req.json();
  if (input?.tidy === true) {
    const rejected = await exactSameOrigin(c, async () => {});
    if (rejected) return rejected;
    return existingSession(c, next);
  }
  await next();
};

/** Denied paid-save attempts must not bootstrap a session through the write API. */
const shareSession: MiddlewareHandler<SessionEnvironment> = async (c, next) => {
  const result = await anonymousSession(c, next);
  if (c.res.status === 403) c.res.headers.delete('set-cookie');
  return result;
};

export const createShareRoute = createRoute({
  middleware: [sameOrigin, shareSession, jsonBody, tidySaveAccess] as const,
  method: 'post',
  path: '/shares',
  operationId: 'createShare',
  tags: ['Shares'],
  summary: 'Save a private text share',
  description:
    'POST is not idempotent. A supplied Origin must match Host/protocol. Optional tidy:true requires an exact Origin and an existing signed session; when transcription is enabled, cleanup completes on the server before creating the record. Cleanup failure returns CLEANUP_UNAVAILABLE without writing a share.',
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      description: `Text plus an optional ISO readingDate is accepted: at most ${MAX_SHARE_TEXT_LENGTH} Unicode code points before trimming, then at least one non-whitespace character. Raw JSON is limited to ${MAX_SHARE_REQUEST_BYTES} bytes. JSON media types are case-insensitive; valid parameters are accepted.`,
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
    400: failed(['INVALID_JSON', 'INVALID_SHARE']),
    403: failed(['CROSS_ORIGIN_REQUEST', 'SESSION_REQUIRED']),
    413: failed(['PAYLOAD_TOO_LARGE']),
    415: failed(['UNSUPPORTED_MEDIA_TYPE']),
    409: failed(['READING_CHANGED']),
    503: failed([
      'READING_UNAVAILABLE',
      'INTERNAL_ERROR',
      'CLEANUP_UNAVAILABLE'
    ]),
    ...commonFailures
  }
});

/** Ownership comes from the session; client input selects a date, never the reading text. */
export const createShare: RouteHandler<
  typeof createShareRoute,
  SessionEnvironment
> = async (c) => {
  await enforceQuota('create', c.get('ownerId'));
  const input = c.req.valid('json');
  let result;
  try {
    result = await createShareForReading(
      c.get('ownerId'),
      input,
      readingTimeZone(getCookie(c, READING_TIME_ZONE_COOKIE)),
      undefined,
      undefined,
      async (text) => {
        if (!input.tidy || process.env.STT_ENABLED !== 'true') return text;
        await enforceQuota('cleanup', c.get('ownerId'));
        try {
          return await cleanShareText(text, c.req.raw.signal);
        } catch (cause) {
          reportTranscriptionFailure(cause, 'cleanup');
          throw new SaveCleanupError();
        }
      }
    );
  } catch (cause) {
    if (cause instanceof SaveCleanupError)
      return c.json(errorBody('CLEANUP_UNAVAILABLE'), 503);
    throw cause;
  }
  if (result.error === 'READING_UNAVAILABLE')
    return c.json(errorBody(result.error), 503);
  if (result.error === 'READING_CHANGED')
    return c.json(errorBody(result.error), 409);
  const { share } = result;
  c.header('Location', `/api/shares/${share.id}`);
  return c.json(shareSchema.parse(share), 201);
};
