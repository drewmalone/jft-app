import 'server-only';
import {
  signRelayTicket,
  validateRelaySecret
} from '../../../../../services/xai-relay/ticket.mjs';
import { relaySigningSecret } from './relay-secret';

/** Validate the fixed relay destination. Credentials never appear in its URL. */
export function xaiRelayConfiguration() {
  const configured = process.env.STT_XAI_RELAY_URL;
  if (!configured) throw new Error('STT_XAI_RELAY_URL is required');
  const url = new URL(configured);
  const local =
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/stt'
  )
    throw new Error(
      'STT_XAI_RELAY_URL must be a secure relay URL ending in /stt'
    );
  if (process.env.STT_XAI_RELAY_SECRET)
    validateRelaySecret(process.env.STT_XAI_RELAY_SECRET);
  else if (
    !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/.test(
      process.env.STT_XAI_RELAY_SECRET_ARN ?? ''
    )
  )
    throw new Error(
      'Configure STT_XAI_RELAY_SECRET or STT_XAI_RELAY_SECRET_ARN'
    );
  return { url: url.href };
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
