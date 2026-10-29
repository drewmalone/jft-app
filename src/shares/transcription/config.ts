/** Deployment choices; contains no credentials and is safe to serialize. */
export type TranscriptionProvider = 'openai' | 'xai';

/** Reject misspellings, empty strings and whitespace instead of silently falling back. */
export function parseTranscriptionProvider(
  value: string | undefined
): TranscriptionProvider {
  if (value === 'openai' || value === 'xai') return value;
  throw new Error('STT_PROVIDER must be explicitly set to openai or xai');
}
