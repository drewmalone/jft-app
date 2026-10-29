import 'server-only';

import { issueTranscriptionCredential as issueOpenAI } from './providers/openai/session';
import { transcriptionProvider } from './transcription-config';

/** Assert the browser bootstrap before issuing credentials. Missing headers support legacy OpenAI clients. */
export async function issueTranscriptionCredential(
  signal: AbortSignal,
  requested: string | undefined
) {
  if ((requested ?? 'openai') !== transcriptionProvider())
    throw new Error('Transcription provider mismatch; reload the application');
  return issueOpenAI(signal);
}
export {
  reportTranscriptionFailure,
  reportTranscriptionConfiguration
} from './providers/openai/diagnostics';
