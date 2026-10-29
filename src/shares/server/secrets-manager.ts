import 'server-only';
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from '@aws-sdk/client-secrets-manager';

const CACHE_MS = 5 * 60_000;

/**
 * One credential binding's AWS read/cache mechanics. The caller owns ARN validation,
 * value validation and safe error classification. Validation runs before caching success;
 * concurrent reads coalesce and failed reads remain retryable.
 */
export function createSecretReader(validate: (value: string) => string) {
  let cached:
    { arn: string; expires: number; value: Promise<string> } | undefined;
  return async ({
    arn,
    region
  }: {
    arn: string;
    region: string;
  }): Promise<string> => {
    if (cached?.arn === arn && cached.expires > Date.now()) return cached.value;
    const client = new SecretsManagerClient({ region, maxAttempts: 2 });
    const value = client
      .send(new GetSecretValueCommand({ SecretId: arn }), {
        abortSignal: AbortSignal.timeout(5_000)
      })
      .then((result) => {
        if (!result.SecretString)
          throw new Error('A plain-string secret is required');
        return validate(result.SecretString);
      })
      .finally(() => client.destroy());
    const entry = { arn, expires: Date.now() + CACHE_MS, value };
    cached = entry;
    try {
      return await value;
    } catch (cause) {
      if (cached === entry) cached = undefined;
      throw cause;
    }
  };
}
