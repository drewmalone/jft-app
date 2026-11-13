import { z } from 'zod';
import { parseTranscriptionProvider } from '../shares/transcription/config';

type Environment = Readonly<Record<string, string | undefined>>;
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
/** Deployment feature choices are independent; emergency records are checked separately at request time. */
export function parseFeatureConfig(env: Environment) {
  const legacy = flag.parse(env.STT_ENABLED ?? 'false');
  return {
    transcription: {
      enabled: flag.parse(env.TRANSCRIPTION_ENABLED ?? String(legacy)),
      disabled: flag.parse(env.TRANSCRIPTION_DISABLED ?? 'false'),
      provider: parseTranscriptionProvider(env.STT_PROVIDER)
    },
    cleanup: {
      enabled: flag.parse(env.CLEANUP_ENABLED ?? String(legacy)),
      disabled: flag.parse(env.CLEANUP_DISABLED ?? 'false'),
      provider: 'openai' as const
    }
  };
}
export type FeatureConfig = ReturnType<typeof parseFeatureConfig>;
