import { createOpenAISpeech } from './providers/openai/engine';
import type { TranscriptionEngineFactory } from './types';
import type { TranscriptionProvider } from './config';
import { createXaiSpeech } from './providers/xai/engine';

/** Browser selection comes exclusively from the runtime server bootstrap. */
export function transcriptionEngineFactory(
  provider: TranscriptionProvider | null
): TranscriptionEngineFactory {
  if (provider === null) throw new Error('Missing transcription provider bootstrap');
  return provider === 'openai' ? createOpenAISpeech : createXaiSpeech;
}

