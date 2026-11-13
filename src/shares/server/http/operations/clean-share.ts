import { draftText } from '../schemas';
import { enforceQuota } from '../../../../server/http/enforce-quota';
import 'server-only';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { error, errorBody } from '../../../../server/http/errors';
import {
  exactSameOrigin,
  existingSession,
  jsonBody,
  type ApiEnvironment
} from '../../../../server/http/middleware';
import {
  commonFailures,
  failed,
  privateHeaders,
  retryAfterHeaders,
  browserOriginHeaders
} from '../../../../server/http/openapi';
import {
  cleanShareText,
  reportTranscriptionFailure
} from '../../cleanup-provider';

const access: MiddlewareHandler<ApiEnvironment> = async (c, next) => {
  if (
    !c.get('services').features.cleanup.enabled ||
    c.get('services').features.cleanup.disabled
  )
    return error('CLEANUP_UNAVAILABLE');
  await next();
};

export const cleanShareRoute = createRoute({
  method: 'post',
  path: '/shares/cleanup',
  operationId: 'cleanShareText',
  tags: ['Shares'],
  summary: 'Tidy an unsaved draft without saving it',
  description:
    'Requires an exact same-origin Origin, existing signed session, and cleanup enabled in deployment configuration. Sends draft text to OpenAI for light copyediting with store:false; returns a suggestion without writing a share.',
  security: [{ AnonymousSession: [] }],
  middleware: [exactSameOrigin, existingSession, access, jsonBody] as const,
  request: {
    headers: browserOriginHeaders,
    body: {
      required: true,
      description:
        'Only the finalized draft, at most 10,000 Unicode code points; raw JSON is limited to 64 KiB.',
      content: { 'application/json': { schema: draftText } }
    }
  },
  responses: {
    200: {
      description:
        'Bounded nonblank cleaned draft; no share or session is created.',
      headers: privateHeaders,
      content: { 'application/json': { schema: draftText } }
    },
    400: failed(['INVALID_JSON', 'INVALID_SHARE']),
    403: failed(['CROSS_ORIGIN_REQUEST', 'SESSION_REQUIRED']),
    413: failed(['PAYLOAD_TOO_LARGE']),
    415: failed(['UNSUPPORTED_MEDIA_TYPE']),
    429: failed(['RATE_LIMITED'], retryAfterHeaders),
    503: failed(['CLEANUP_UNAVAILABLE']),
    ...commonFailures
  }
});

/** Preserve the original in the browser on any failure; never write draft/provider content to logs or the repository. */
export const cleanShare: RouteHandler<
  typeof cleanShareRoute,
  ApiEnvironment
> = async (c) => {
  await enforceQuota('cleanup', c.get('ownerId'), c.get('services').quotas);
  try {
    const text = await cleanShareText(
      c.req.valid('json').text,
      c.req.raw.signal
    );
    return c.json({ text }, 200);
  } catch (cause) {
    reportTranscriptionFailure(cause, 'cleanup');
    return c.json(errorBody('CLEANUP_UNAVAILABLE'), 503);
  }
};
