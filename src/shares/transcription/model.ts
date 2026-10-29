import { z } from 'zod';

/** Temporary connection credential only; never a permanent provider key. */
export const transcriptionCredentialSchema = z.object({
  value: z
    .string()
    .min(1)
    .describe(
      'Short-lived bearer credential for establishing a provider connection. Treat as secret; never log or persist.'
    ),
  expires_at: z
    .number()
    .int()
    .positive()
    .describe(
      'Credential expiry as Unix time in seconds. Limits connection establishment, not the lifetime of an established recording.'
    )
});

/** Relay tickets authorize one connection; they are never provider API keys. */
export const xaiSessionSchema = transcriptionCredentialSchema.extend({
  provider: z.literal('xai'),
  relay_url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'wss:' ||
        (url.protocol === 'ws:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/stt'
    );
  })
});

export const transcriptionSessionSchema = z.union([
  xaiSessionSchema,
  transcriptionCredentialSchema.extend({
    provider: z.literal('openai').optional()
  })
]);
