import 'server-only';

import { issueSonioxCredential } from './providers/soniox/session';
import { issueTranscriptionCredential as issueOpenAI } from './providers/openai/session';
import type { TranscriptionProvider } from '../transcription/config';

/** Assert the browser bootstrap before issuing credentials. Missing headers support legacy OpenAI clients. */
export async function issueTranscriptionCredential(
  provider: TranscriptionProvider,
  signal: AbortSignal,
  requested: string | undefined
) {
  if ((requested ?? 'openai') !== provider)
    throw new Error('Transcription provider mismatch; reload the application');
  if (provider === 'soniox') return issueSonioxCredential(signal);
  if (provider !== 'openai')
    throw new Error('The xAI integration is not installed');
  return issueOpenAI(signal);
}
export {
  reportTranscriptionFailure,
  reportTranscriptionConfiguration
} from './providers/openai/diagnostics';
