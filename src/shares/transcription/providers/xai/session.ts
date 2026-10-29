import { z } from 'zod';
import { relayUrlSchema } from '../../../../../shared/xai-relay/contract.mjs';
import { transcriptionCredentialSchema } from '../../model';

/** A single-use relay ticket, never an xAI API key. */
export const xaiSessionSchema = transcriptionCredentialSchema.extend({
  provider: z.literal('xai'),
  relay_url: relayUrlSchema
});
