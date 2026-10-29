import { relayEndpoint } from '../../shared/xai-relay/contract.mjs';
import { validateRelaySecret } from '../../shared/xai-relay/ticket.node.mjs';

/** Validate before listening. Keys are relay-only; no credentials appear in errors. @param {Readonly<Record<string, string | undefined>>} env */
export function relayConfiguration(env) {
  const secret = validateRelaySecret(env.STT_XAI_RELAY_SECRET);
  const key = env.STT_XAI_API_KEY;
  if (!key) throw new Error('STT_XAI_API_KEY is required on the relay');
  const audience = relayEndpoint(
    env.STT_XAI_RELAY_URL,
    env.NODE_ENV === 'production'
  );
  const origins = new Set(
    (env.STT_XAI_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)
  );
  if (!origins.size) throw new Error('STT_XAI_ALLOWED_ORIGINS is required');
  for (const origin of origins)
    if (new URL(origin).origin !== origin)
      throw new Error('Use exact allowed origins');
  return { secret, key, audience, origins };
}
