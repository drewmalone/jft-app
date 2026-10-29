import 'server-only';
import { createSecretReader } from '../../secrets-manager';
import { validateRelaySecret } from '../../../../../shared/xai-relay/ticket.node.mjs';
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

const readSecret = createSecretReader(validateRelaySecret);

/** Resolve only the relay signing key; the xAI API key stays on the relay service. */
export async function relaySigningSecret(): Promise<string> {
  if (process.env.STT_XAI_RELAY_SECRET)
    return validateRelaySecret(process.env.STT_XAI_RELAY_SECRET);
  const { arn, region } = parseRelaySecretArn(
    process.env.STT_XAI_RELAY_SECRET_ARN
  );
  try {
    return await readSecret({ arn, region });
  } catch {
    throw new Error('Relay signing secret unavailable');
  }
}
