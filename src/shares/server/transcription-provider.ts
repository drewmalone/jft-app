import 'server-only';

// Server composition uses the same fixed selection as the page bootstrap.
// Provider error classification stays here so HTTP handlers never inspect SDK errors.
import { issueTranscriptionCredential as issueOpenAI } from './providers/openai/session';
import { issueXaiSession } from './providers/xai/session';
import { transcriptionProvider } from './transcription-config';

/** Session authorization and browser bootstrap share one immutable server selection. */
export async function issueTranscriptionCredential(
  signal: AbortSignal,
  origin: string,
  requested: string | undefined
) {
  const provider = transcriptionProvider();
  // Missing header remains compatible with pre-configuration OpenAI clients only.
  if ((requested ?? 'openai') !== provider)
    throw new Error('Transcription provider mismatch; reload the application');
  return provider === 'openai' ? issueOpenAI(signal) : issueXaiSession(origin);
}
export {
  reportTranscriptionFailure,
  reportTranscriptionConfiguration
} from './providers/openai/diagnostics';
