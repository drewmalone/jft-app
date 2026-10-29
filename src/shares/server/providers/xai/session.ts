import 'server-only';
import {
  signRelayTicket,
  validateRelaySecret
} from '../../../../../services/xai-relay/ticket.mjs';
import { relaySigningSecret, parseRelaySecretArn } from './relay-secret';
import { xaiRelayUrlSchema } from '../../../transcription/providers/xai/session';

/** Validate the fixed relay destination. Credentials never appear in its URL. */
export function xaiRelayConfiguration() {
  const configured = process.env.STT_XAI_RELAY_URL;
  if (!configured) throw new Error('STT_XAI_RELAY_URL is required');
  const parsed = xaiRelayUrlSchema.safeParse(configured);
  if (
    !parsed.success ||
    (process.env.NODE_ENV === 'production' && !parsed.data.startsWith('wss:'))
  )
    throw new Error(
      'STT_XAI_RELAY_URL must be a secure relay URL ending in /stt'
    );
  if (process.env.STT_XAI_RELAY_SECRET)
    validateRelaySecret(process.env.STT_XAI_RELAY_SECRET);
  else parseRelaySecretArn(process.env.STT_XAI_RELAY_SECRET_ARN);
  return { url: parsed.data };
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
