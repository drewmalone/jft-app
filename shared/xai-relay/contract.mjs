import { z } from 'zod';

const sampleRate = 48_000;
const bytesPerSample = 2;
const frameDurationMs = 100;
const bytesPerSecond = sampleRate * bytesPerSample;

/** Browser-safe mono PCM16 wire format. All frame/rate limits derive from this definition. */
export const relayAudio = Object.freeze({
  sampleRate,
  bytesPerSample,
  frameDurationMs,
  samplesPerFrame: (sampleRate * frameDurationMs) / 1000,
  frameBytes: (bytesPerSecond * frameDurationMs) / 1000,
  bytesPerSecond,
  maxBufferedBytes: bytesPerSecond * 2,
  jitterSeconds: 2
});

/** Shared application-protocol bounds; contains no credentials or provider API configuration. */
export const relayLimits = Object.freeze({
  path: '/stt',
  maxEventBytes: 65_536,
  maxTextCharacters: 20_000,
  maxAuthBytes: 4096,
  maxControlBytes: 128,
  maxTicketCharacters: 2048,
  ticketLifetimeSeconds: 60,
  authTimeoutMs: 5_000,
  startTimeoutMs: 20_000,
  finalTimeoutMs: 5_000,
  maxSessionMs: 10 * 60_000,
  maxConnections: 32
});

/** Canonical relay endpoint only: no credentials, query, fragment or alternate path. */
export const relayUrlSchema = z
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) =>
      (url.protocol === 'wss:' ||
        (url.protocol === 'ws:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      url.href === `${url.origin}${relayLimits.path}`
  )
  .transform((url) => url.href);

/** Apply the deployment's TLS rule consistently on the issuer and relay. @param {unknown} value @param {boolean} production */
export function relayEndpoint(value, production) {
  const result = relayUrlSchema.safeParse(value);
  if (!result.success || (production && !result.data.startsWith('wss:')))
    throw new Error(
      'STT_XAI_RELAY_URL must be a secure relay URL ending in /stt'
    );
  return result.data;
}

/** The relay owns provider events; only these ordered application events reach browsers. */
export const relayEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('interim'),
    text: z.string().max(relayLimits.maxTextCharacters)
  }),
  z.object({
    type: z.literal('final'),
    text: z.string().max(relayLimits.maxTextCharacters)
  }),
  z.object({ type: z.literal('ended') }),
  z.object({ type: z.literal('error') })
]);

export const relayCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('authenticate'),
    ticket: z.string().min(1).max(relayLimits.maxTicketCharacters)
  }),
  z.object({ type: z.literal('stop') })
]);

/** @typedef {import('zod').infer<typeof relayEventSchema>} RelayEvent */
/** @typedef {import('zod').infer<typeof relayCommandSchema>} RelayCommand */
