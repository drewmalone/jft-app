import { z } from 'zod';
import { parseTranscriptionProvider } from '../shares/transcription/config';

type Environment = Readonly<Record<string, string | undefined>>;
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
/** Speech is available by default. Emergency controls and quotas still gate credential issuance. */
export function parseFeatureConfig(env: Environment) {
  return {
    transcription: {
      disabled: flag.parse(env.TRANSCRIPTION_DISABLED ?? 'false'),
      provider: parseTranscriptionProvider(env.STT_PROVIDER)
    },
    cleanup: {
      enabled: flag.parse(env.CLEANUP_ENABLED ?? 'false'),
      disabled: flag.parse(env.CLEANUP_DISABLED ?? 'false'),
      provider: 'openai' as const
    }
  };
}
export type FeatureConfig = ReturnType<typeof parseFeatureConfig>;
