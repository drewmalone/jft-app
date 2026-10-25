import 'server-only';
import OpenAI from 'openai';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { getSession } from './session';
import {
  reportTranscriptionFailure,
  reportTranscriptionConfiguration
} from './transcription-diagnostics';
import { transcriptionKey } from './transcription-key';
import { privateHeaders, commonFailures } from './openapi';
import type { SessionEnvironment } from './middleware';

const credentials = z.object({ value: z.string(), expires_at: z.number() });
const unavailable = {
  error: 'Transcription is unavailable. You can still type and save your share.'
};
const failure = (description: string) => ({
  description,
  headers: privateHeaders,
  content: { 'application/json': { schema: z.object({ error: z.string() }) } }
});

export const transcriptionSessionRoute = createRoute({
  method: 'post',
  path: '/transcription/session',
  operationId: 'createTranscriptionSession',
  tags: ['Transcription'],
  summary: 'Issue a short-lived live transcription credential',
  description:
    'Requires an existing signed session and an exact same-origin Origin header. No audio or transcript body is accepted. Disabled unless STT_ENABLED=true. Credentials are never cached.',
  security: [{ AnonymousSession: [] }],
  responses: {
    200: {
      description:
        'Ephemeral OpenAI credential; expires after 60 seconds for establishing connections, not terminating active sessions.',
      headers: privateHeaders,
      content: { 'application/json': { schema: credentials } }
    },
    403: failure('Origin or existing signed session is missing or invalid.'),
    429: failure(
      'Process-local issuance limit exceeded; Retry-After is 60 seconds.'
    ),
    503: failure('Disabled, missing configuration, or provider unavailable.'),
    ...commonFailures
  }
});

// A bounded, process-local burst guard only. Hosted preview access protection is still required.
const runtime = globalThis as typeof globalThis & {
  doorknobSpeechLimits?: Map<string, { until: number; count: number }>;
};
function limited(owner: string) {
  const limits = (runtime.doorknobSpeechLimits ??= new Map());
  const now = Date.now();
  for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key);
  let entry = limits.get(owner);
  if (!entry) {
    if (limits.size >= 1_000) return true;
    entry = { until: now + 60_000, count: 0 };
    limits.set(owner, entry);
  }
  return ++entry.count > 5;
}

/** The trusted server fixes the initial transcription session and never returns the permanent key. */
export async function issueTranscriptionCredential(signal?: AbortSignal) {
  const client = new OpenAI({
    apiKey: await transcriptionKey(),
    maxRetries: 0,
    logLevel: 'off',
    timeout: 10_000
  });
  return client.realtime.clientSecrets.create(
    {
      expires_after: { anchor: 'created_at', seconds: 60 },
      session: {
        type: 'transcription',
        audio: {
          input: {
            transcription: { model: 'gpt-live-transcribe', language: 'en' },
            turn_detection: null,
            noise_reduction: { type: 'near_field' }
          }
        }
      }
    },
    { signal }
  );
}

/** Validate the browser boundary before spending provider credits; failures disclose no upstream details. */
export const createTranscriptionSession: RouteHandler<
  typeof transcriptionSessionRoute,
  SessionEnvironment
> = async (c) => {
  const url = new URL(c.req.url);
  // Match the existing BFF origin boundary when the Node listener differs from the public Host.
  const authority = c.req.header('host') ?? url.host;
  if (c.req.header('origin') !== `${url.protocol}//${authority}`)
    return c.json(unavailable, 403);
  try {
    const session = await getSession(c.req.raw);
    if (session.newSession) return c.json(unavailable, 403);
    if (process.env.STT_ENABLED !== 'true') {
      reportTranscriptionConfiguration('disabled');
      return c.json(unavailable, 503);
    }
    if (limited(session.ownerId)) {
      c.header('Retry-After', '60');
      return c.json(unavailable, 429);
    }
    const token = await issueTranscriptionCredential(c.req.raw.signal);
    const result = credentials.safeParse(token);
    if (!result.success) {
      reportTranscriptionConfiguration('invalid_provider_response');
      return c.json(unavailable, 503);
    }
    return c.json(result.data, 200);
  } catch (cause) {
    reportTranscriptionFailure(cause);
    return c.json(unavailable, 503);
  }
};
