import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** @param {string | undefined} secret */
export function validateRelaySecret(secret) {
  if (!secret || Buffer.byteLength(secret) < 32)
    throw new Error('STT_XAI_RELAY_SECRET must contain at least 32 bytes');
  return secret;
}

/** @param {string} secret @param {string} audience @param {string} origin @param {number} [now] */
export function signRelayTicket(secret, audience, origin, now = Date.now()) {
  validateRelaySecret(secret);
  const claims = {
    aud: audience,
    origin,
    nonce: randomUUID(),
    exp: Math.floor(now / 1000) + 60
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return { value: `${payload}.${mac}`, expires_at: claims.exp };
}

/** Verify before inspecting claims. The relay must additionally consume nonce exactly once.
 * @param {string} ticket @param {string} secret @param {string} audience @param {string} origin @param {number} [now]
 * @returns {{ aud: string, origin: string, nonce: string, exp: number }}
 */
export function verifyRelayTicket(
  ticket,
  secret,
  audience,
  origin,
  now = Date.now()
) {
  validateRelaySecret(secret);
  if (typeof ticket !== 'string' || ticket.length > 2048)
    throw new Error('Invalid relay ticket');
  const [payload, signature, extra] = ticket.split('.');
  if (!payload || !signature || extra !== undefined)
    throw new Error('Invalid relay ticket');
  const actual = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error('Invalid relay ticket');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const seconds = Math.floor(now / 1000);
  if (
    claims.aud !== audience ||
    claims.origin !== origin ||
    typeof claims.nonce !== 'string' ||
    claims.nonce.length > 64 ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= seconds ||
    claims.exp > seconds + 60
  )
    throw new Error('Invalid relay ticket');
  return claims;
}
