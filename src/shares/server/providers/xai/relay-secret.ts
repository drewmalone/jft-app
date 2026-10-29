import 'server-only';
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from '@aws-sdk/client-secrets-manager';
import { validateRelaySecret } from '../../../../../services/xai-relay/ticket.mjs';
import { parse as parseArn, validate as isArn } from '@aws-sdk/core/util';

/** Use AWS's ARN parser for structure, then constrain this binding to a regional secret. */
export function parseRelaySecretArn(value: string | undefined) {
  const invalid = () =>
    new Error('STT_XAI_RELAY_SECRET_ARN must name a Secrets Manager secret');
  if (!value || !isArn(value)) throw invalid();
  const parsed = parseArn(value);
  const [kind, name, extra] = parsed.resource.split(':');
  if (
    !parsed.partition ||
    parsed.service !== 'secretsmanager' ||
    !parsed.region ||
    !parsed.accountId ||
    kind !== 'secret' ||
    !name ||
    extra !== undefined
  )
    throw invalid();
  return { arn: value, region: parsed.region };
}

let cached:
  { arn: string; expires: number; value: Promise<string> } | undefined;

/** Resolve only the relay signing key; the xAI API key stays on the relay service. */
export async function relaySigningSecret(): Promise<string> {
  if (process.env.STT_XAI_RELAY_SECRET)
    return validateRelaySecret(process.env.STT_XAI_RELAY_SECRET);
  const { arn, region } = parseRelaySecretArn(
    process.env.STT_XAI_RELAY_SECRET_ARN
  );
  if (cached?.arn === arn && cached.expires > Date.now()) return cached.value;
  const client = new SecretsManagerClient({
    region,
    maxAttempts: 2
  });
  const value = client
    .send(new GetSecretValueCommand({ SecretId: arn }), {
      abortSignal: AbortSignal.timeout(5_000)
    })
    .then((result) => validateRelaySecret(result.SecretString))
    .finally(() => client.destroy());
  const entry = { arn, expires: Date.now() + 5 * 60_000, value };
  cached = entry;
  try {
    return await value;
  } catch {
    if (cached === entry) cached = undefined;
    throw new Error('Relay signing secret unavailable');
  }
}
