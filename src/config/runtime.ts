import { z } from 'zod';
import { parseSecretArn } from './secret-arn';
import { parseFeatureConfig } from './features';
import { parseQuotaConfig, quotaSetting, type QuotaOperation } from './quotas';

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
  return {
    ...readingSource.parse({
      READINGS_SOURCE: env.READINGS_SOURCE ?? 'local',
      READINGS_LOCAL_PATH:
        env.READINGS_LOCAL_PATH ?? 'infra/terraform/readings.example.yaml',
      READINGS_S3_BUCKET: env.READINGS_S3_BUCKET,
      READINGS_S3_KEY: env.READINGS_S3_KEY ?? 'just-for-today.yaml',
      READINGS_REGION: env.READINGS_REGION ?? env.AWS_REGION
    }),
    READINGS_SAMPLE: z
      .enum(['true', 'false'])
      .parse(
        env.READINGS_SAMPLE ?? (env.READINGS_SOURCE === 's3' ? 'false' : 'true')
      )
  };
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
/** Validate deployment settings without reading secrets, catalogs or AWS data. */
export function validateRuntimeConfig(env: Environment) {
  return {
    storage: parsePersistenceConfig(env),
    readings: parseReadingsConfig(env),
    features: parseFeatureConfig(env),
    quotas: parseQuotaConfig(env),
    openAISecretArn: secretArn.parse(env.STT_OPENAI_SECRET_ARN ?? ''),
    sonioxSecretArn: secretArn.parse(env.STT_SONIOX_SECRET_ARN ?? '')
  };
}
/** Flatten validated nonsecret settings for Amplify's SSR environment artifact. */
export function parseRuntimeConfig(env: Environment) {
  const config = validateRuntimeConfig(env);
  const quotaSettings: Record<string, string> = {};
  for (const [operation, rules] of Object.entries(config.quotas.policy)) {
    for (const rule of rules) {
      const key = quotaSetting(operation as QuotaOperation, rule.seconds);
      quotaSettings[key] = String(rule.limit);
    }
  }
  return {
    ...config.storage,
    ...config.readings,
    ...quotaSettings,
    QUOTA_TABLE_NAME: config.quotas.tableName,
    STT_ENABLED: env.STT_ENABLED ?? 'false', // Migration fallback; feature flags below are authoritative.
    STT_PROVIDER: config.features.transcription.provider,
    TRANSCRIPTION_ENABLED: String(config.features.transcription.enabled),
    CLEANUP_ENABLED: String(config.features.cleanup.enabled),
    TRANSCRIPTION_DISABLED: String(config.features.transcription.disabled),
    CLEANUP_DISABLED: String(config.features.cleanup.disabled),
    STT_OPENAI_SECRET_ARN: config.openAISecretArn,
    STT_SONIOX_SECRET_ARN: config.sonioxSecretArn
  };
}
