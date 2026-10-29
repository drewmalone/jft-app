import { validateRelaySecret } from './ticket.mjs';

/** Validate before listening. Keys are relay-only; no credentials appear in errors. */
export function relayConfiguration(env) {
  const secret = validateRelaySecret(env.STT_XAI_RELAY_SECRET);
  const key = env.STT_XAI_API_KEY;
  if (!key) throw new Error('STT_XAI_API_KEY is required on the relay');
  const audience = env.STT_XAI_RELAY_URL;
  if (!audience) throw new Error('STT_XAI_RELAY_URL is required');
  const url = new URL(audience);
  if (
    url.pathname !== '/stt' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== 'wss:' &&
      !(
        env.NODE_ENV !== 'production' &&
        url.protocol === 'ws:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error('Configure a secure STT_XAI_RELAY_URL ending in /stt');
  const origins = new Set(
    (env.STT_XAI_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)
  );
  if (!origins.size) throw new Error('STT_XAI_ALLOWED_ORIGINS is required');
  for (const origin of origins)
    if (new URL(origin).origin !== origin)
      throw new Error('Use exact allowed origins');
  return { secret, key, audience: url.href, origins };
}
