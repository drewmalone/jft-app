import 'server-only';
import '@hono/zod-openapi';
import { shareSchema } from '../../model';
import { cleanupTextSchema } from '../../cleanup/model';
import { transcriptionCredentialSchema } from '../../transcription/model';

/** Decorate feature schemas at the HTTP boundary, after OpenAPI initialization. */
export const share = shareSchema.clone().openapi('Share', {
  additionalProperties: false
});

export const draftText = cleanupTextSchema.clone().openapi('DraftText');
export const transcriptionCredential = transcriptionCredentialSchema
  .clone()
  .openapi('TranscriptionCredential');
