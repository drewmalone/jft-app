import { createOpenAISpeech } from './providers/openai/engine';
import type { TranscriptionEngineFactory } from './types';
import type { TranscriptionProvider } from './config';

/** Select only a provider installed in this release; never silently fall back. */
export function transcriptionEngineFactory(
  provider: TranscriptionProvider | null
): TranscriptionEngineFactory {
  if (provider === null)
    throw new Error('Missing transcription provider bootstrap');
  if (provider !== 'openai')
    throw new Error('The xAI adapter is not installed');
  return createOpenAISpeech;
}
