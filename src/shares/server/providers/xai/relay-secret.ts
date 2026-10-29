import 'server-only';
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from '@aws-sdk/client-secrets-manager';
import { validateRelaySecret } from '../../../../../services/xai-relay/ticket.mjs';

let cached:
  { arn: string; expires: number; value: Promise<string> } | undefined;

/** Resolve only the relay signing key; the xAI API key stays on the relay service. */
export async function relaySigningSecret(): Promise<string> {
  if (process.env.STT_XAI_RELAY_SECRET)
    return validateRelaySecret(process.env.STT_XAI_RELAY_SECRET);
  const arn = process.env.STT_XAI_RELAY_SECRET_ARN;
  if (
    !arn ||
    !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/.test(
      arn
    )
  )
    throw new Error(
      'Configure STT_XAI_RELAY_SECRET or STT_XAI_RELAY_SECRET_ARN'
    );
  if (cached?.arn === arn && cached.expires > Date.now()) return cached.value;
  const client = new SecretsManagerClient({
    region: arn.split(':')[3],
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
