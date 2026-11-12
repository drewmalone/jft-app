import { z } from 'zod';
import { parseSecretArn } from './secret-arn';
import { transcriptionProviderSchema } from '../shares/transcription/config';

type Environment = Readonly<Record<string, string | undefined>>;
const persistence = z.discriminatedUnion('SHARE_PERSISTENCE', [
  z.object({ SHARE_PERSISTENCE: z.literal('memory') }),
  z.object({
    SHARE_PERSISTENCE: z.literal('dynamodb'),
    DYNAMODB_TABLE_NAME: z.string().trim().min(3).max(255),
    DYNAMODB_REGION: z.string().trim().min(1)
  })
]);
/** Pure configuration parsing, shared by deployment preparation and storage. Throws on invalid settings. */
export function parsePersistenceConfig(env: Environment) {
  return persistence.parse({
    SHARE_PERSISTENCE: env.SHARE_PERSISTENCE ?? 'memory',
    DYNAMODB_TABLE_NAME: env.DYNAMODB_TABLE_NAME,
    DYNAMODB_REGION: env.DYNAMODB_REGION ?? env.AWS_REGION
  });
}
const readingSource = z.discriminatedUnion('READINGS_SOURCE', [
  z.object({
    READINGS_SOURCE: z.literal('local'),
    READINGS_LOCAL_PATH: z.string().trim().min(1)
  }),
  z.object({
    READINGS_SOURCE: z.literal('s3'),
    READINGS_S3_BUCKET: z.string().trim().min(3),
    READINGS_S3_KEY: z.string().trim().min(1),
    READINGS_REGION: z.string().trim().min(1)
  })
]);
/** Select a complete YAML catalog. Invalid deployment settings never fall back to local content. */
export function parseReadingsConfig(env: Environment) {
  return readingSource.parse({
    READINGS_SOURCE: env.READINGS_SOURCE ?? 'local',
    READINGS_LOCAL_PATH:
      env.READINGS_LOCAL_PATH ?? 'infra/terraform/readings.example.yaml',
    READINGS_S3_BUCKET: env.READINGS_S3_BUCKET,
    READINGS_S3_KEY: env.READINGS_S3_KEY ?? 'just-for-today.yaml',
    READINGS_REGION: env.READINGS_REGION ?? env.AWS_REGION
  });
}
const secretArn = z.string().refine((value) => {
  if (!value) return true;
  try {
    parseSecretArn(value);
    return true;
  } catch {
    return false;
  }
}, 'Expected a regional Secrets Manager secret ARN.');
const speech = z.object({
  STT_ENABLED: z.enum(['true', 'false']),
  STT_PROVIDER: transcriptionProviderSchema,
  STT_SONIOX_SECRET_ARN: secretArn,
  STT_OPENAI_SECRET_ARN: secretArn
});
/** Return only allowlisted nonsecret runtime settings. Secret values are never copied. */
export function parseRuntimeConfig(env: Environment) {
  return {
    ...parsePersistenceConfig(env),
    ...parseReadingsConfig(env),
    ...speech.parse({
      STT_ENABLED: env.STT_ENABLED ?? 'false',
      STT_PROVIDER: env.STT_PROVIDER,
      STT_SONIOX_SECRET_ARN: env.STT_SONIOX_SECRET_ARN ?? '',
      STT_OPENAI_SECRET_ARN: env.STT_OPENAI_SECRET_ARN ?? ''
    })
  };
}
