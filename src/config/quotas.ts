import { z } from 'zod';

export type QuotaOperation = 'transcription' | 'cleanup' | 'create' | 'private';
export type QuotaRule = { seconds: number; limit: number };
export type QuotaPolicy = Record<QuotaOperation, readonly QuotaRule[]>;
export const quotaPolicy: QuotaPolicy = {
  transcription: [
    { seconds: 600, limit: 3 },
    { seconds: 86400, limit: 15 }
  ],
  cleanup: [
    { seconds: 600, limit: 5 },
    { seconds: 86400, limit: 30 }
  ],
  create: [
    { seconds: 3600, limit: 10 },
    { seconds: 86400, limit: 50 }
  ],
  private: [{ seconds: 60, limit: 120 }]
};
export const quotaSetting = (operation: QuotaOperation, seconds: number) =>
  `QUOTA_${operation.toUpperCase()}_OWNER_${seconds}`;
const allowance = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

/** Only known per-owner windows are supported. Legacy global settings are ignored. */
export function parseQuotaPolicy(
  env: Readonly<Record<string, string | undefined>>
): QuotaPolicy {
  const rules = (operation: QuotaOperation) =>
    quotaPolicy[operation].map((rule) => {
      const value = env[quotaSetting(operation, rule.seconds)];
      return {
        ...rule,
        limit: value === undefined ? rule.limit : allowance.parse(value)
      };
    });
  return {
    transcription: rules('transcription'),
    cleanup: rules('cleanup'),
    create: rules('create'),
    private: rules('private')
  };
}

export function parseQuotaConfig(
  env: Readonly<Record<string, string | undefined>>
) {
  return {
    tableName: z
      .union([z.literal(''), z.string().regex(/^[A-Za-z0-9_.-]{3,255}$/)])
      .parse(env.QUOTA_TABLE_NAME ?? ''),
    policy: parseQuotaPolicy(env)
  };
}
