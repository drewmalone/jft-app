/** Wire settings, independent of relay credentials. PCM uses the AudioContext's fixed rate. */
export const xaiConfig = Object.freeze({
  model: 'grok-voice-transcribe-2.0',
  sampleRate: 48_000,
  startTimeoutMs: 20_000,
  finalTimeoutMs: 5_000,
  maxSessionMs: 10 * 60_000,
  maxBufferedBytes: 192_000
});
