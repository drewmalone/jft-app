import 'server-only';
import {
  signRelayTicket,
  validateRelaySecret
} from '../../../../../shared/xai-relay/ticket.node.mjs';
import { relaySigningSecret, parseRelaySecretArn } from './relay-secret';
import { relayEndpoint } from '../../../../../shared/xai-relay/contract.mjs';

/** Validate the fixed relay destination. Credentials never appear in its URL. */
export function xaiRelayConfiguration() {
  const url = relayEndpoint(
    process.env.STT_XAI_RELAY_URL,
    process.env.NODE_ENV === 'production'
  );
  if (process.env.STT_XAI_RELAY_SECRET)
    validateRelaySecret(process.env.STT_XAI_RELAY_SECRET);
  else parseRelaySecretArn(process.env.STT_XAI_RELAY_SECRET_ARN);
  return { url };
}

/** The Amplify server signs a one-minute relay ticket. Only the relay needs STT_XAI_API_KEY. */
export async function issueXaiSession(origin: string) {
  const { url } = xaiRelayConfiguration();
  const secret = await relaySigningSecret();
  return {
    provider: 'xai' as const,
    relay_url: url,
    ...signRelayTicket(secret, url, origin)
  };
}
