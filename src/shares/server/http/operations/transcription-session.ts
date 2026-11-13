import { transcriptionCredential } from '../schemas';
import { QuotaHttpError } from '../../../../server/http/quota-error';
import { enforceQuota } from '../../../../server/http/enforce-quota';
import 'server-only';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  reportTranscriptionFailure,
  reportTranscriptionConfiguration,
  issueTranscriptionCredential
} from '../../transcription-provider';
import {
  privateHeaders,
  commonFailures,
  failed,
  retryAfterHeaders,
  browserOriginHeaders
} from '../../../../server/http/openapi';
import {
  exactSameOrigin,
  existingSession,
  type ApiEnvironment
} from '../../../../server/http/middleware';
import { errorBody } from '../../../../server/http/errors';

export const transcriptionSessionRoute = createRoute({
  middleware: [exactSameOrigin, existingSession] as const,
  method: 'post',
  path: '/transcription/session',
  operationId: 'createTranscriptionSession',
  tags: ['Transcription'],
  summary: 'Issue a short-lived live transcription credential',
  description:
    'Requires an existing signed session and an exact same-origin Origin header. No audio or transcript body is accepted. Requires transcription to be enabled in deployment configuration. Credentials are never cached.',
  security: [{ AnonymousSession: [] }],
  request: {
    headers: browserOriginHeaders.extend({
      'x-stt-provider': z
        .string()
        .optional()
        .describe(
          'Provider received from the runtime server bootstrap. A mismatch fails with 503; absent means a legacy OpenAI client.'
        )
    })
  },
  responses: {
    200: {
      description:
        'Ephemeral provider credential; expires after 60 seconds for establishing connections. Soniox additionally limits active sessions to ten minutes.',
      headers: privateHeaders,
      content: { 'application/json': { schema: transcriptionCredential } }
    },
    403: failed(['CROSS_ORIGIN_REQUEST', 'SESSION_REQUIRED']),
    429: failed(['RATE_LIMITED'], retryAfterHeaders),
    503: failed(['TRANSCRIPTION_UNAVAILABLE']),
    ...commonFailures
  }
});

/** Validate the browser boundary before spending provider credits; failures disclose no upstream details. */
export const createTranscriptionSession: RouteHandler<
  typeof transcriptionSessionRoute,
  ApiEnvironment
> = async (c) => {
  try {
    if (
      !c.get('services').features.transcription.enabled ||
      c.get('services').features.transcription.disabled
    ) {
      reportTranscriptionConfiguration('disabled');
      return c.json(errorBody('TRANSCRIPTION_UNAVAILABLE'), 503);
    }
    await enforceQuota(
      'transcription',
      c.get('ownerId'),
      c.get('services').quotas
    );
    const token = await issueTranscriptionCredential(
      c.get('services').features.transcription.provider,
      c.req.raw.signal,
      c.req.header('x-stt-provider')
    );
    const result = transcriptionCredential.safeParse(token);
    if (!result.success) {
      reportTranscriptionConfiguration('invalid_provider_response');
      return c.json(errorBody('TRANSCRIPTION_UNAVAILABLE'), 503);
    }
    return c.json(result.data, 200);
  } catch (cause) {
    if (cause instanceof QuotaHttpError) throw cause;
    reportTranscriptionFailure(cause);
    return c.json(errorBody('TRANSCRIPTION_UNAVAILABLE'), 503);
  }
};
