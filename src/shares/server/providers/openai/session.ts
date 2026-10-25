import 'server-only';
import { openAIClient } from './client';

/** The trusted server fixes the initial transcription session and never returns the permanent key. */
export async function issueTranscriptionCredential(signal?: AbortSignal) {
  const client = await openAIClient(10_000);
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
