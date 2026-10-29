import { z } from 'zod';
import { transcriptionCredentialSchema } from '../../model';

/** Nonsecret xAI relay settings shared by its browser adapter and server issuer. */
export const xaiRelayUrlSchema = z
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) =>
      (url.protocol === 'wss:' ||
        (url.protocol === 'ws:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/stt'
  )
  .transform((url) => url.href);

/** A single-use relay ticket, never an xAI API key. */
export const xaiSessionSchema = transcriptionCredentialSchema.extend({
  provider: z.literal('xai'),
  relay_url: xaiRelayUrlSchema
});
