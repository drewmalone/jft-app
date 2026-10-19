import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const processState = globalThis as typeof globalThis & {
  doorknobShareLinkSecret?: string;
};
const defaultLifetime = 7 * 24 * 60 * 60;
const uuid = z.uuid();

function secret() {
  const configured = process.env.SHARE_LINK_SECRET;
  if (configured && Buffer.byteLength(configured) >= 32) {
    if (configured === process.env.SESSION_SECRET)
      throw new Error('Sharing requires a separate secret.');
    return configured;
  }
  if (process.env.NODE_ENV === 'production' || configured !== undefined)
    throw new Error('SHARE_LINK_SECRET must contain at least 32 bytes.');
  return (processState.doorknobShareLinkSecret ??=
    randomBytes(32).toString('base64'));
}
function lifetime() {
  const value = process.env.SHARE_LINK_TTL_SECONDS;
  if (value === undefined) return defaultLifetime;
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 365 * 24 * 60 * 60)
    throw new Error('SHARE_LINK_TTL_SECONDS must be 1–31536000.');
  return Number(value);
}
function signature(id: string, expires: string, key: string) {
  return createHmac('sha256', key)
    .update(`share:v1\n${id}\n${expires}`)
    .digest();
}

/**
 * Signs only a validated ID and absolute expiry; callers must first verify ownership.
 * @param id - Owned share UUID, never reflection text.
 * @param now - Unix seconds, injectable for deterministic tests.
 * @returns A same-origin relative bearer URL and Unix expiration timestamp.
 * @throws On invalid ID, clock, lifetime, or signing configuration. Never log the result.
 */
export function createShareLink(
  id: string,
  now = Math.floor(Date.now() / 1000)
) {
  uuid.parse(id);
  const expiresAt = now + lifetime();
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiresAt))
    throw new Error('Invalid clock.');
  const expires = String(expiresAt);
  const sig = signature(id, expires, secret()).toString('base64url');
  return { url: `/s/${id}?expires=${expires}&sig=${sig}`, expiresAt };
}

/**
 * Authenticates a versioned capability before any repository lookup.
 * @param id - Untrusted share UUID.
 * @param expires - Canonical decimal Unix seconds; arrays/duplicates are invalid.
 * @param sig - Canonical unpadded base64url SHA256 MAC.
 * @param now - Unix seconds, injectable for expiry tests.
 * @returns False for malformed, tampered, or expired capabilities.
 * @throws On invalid server signing configuration; callers must fail closed.
 */
export function verifyShareLink(
  id: string,
  expires: unknown,
  sig: unknown,
  now = Math.floor(Date.now() / 1000)
) {
  if (
    !uuid.safeParse(id).success ||
    typeof expires !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(expires) ||
    typeof sig !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(sig)
  )
    return false;
  const timestamp = Number(expires);
  if (
    !Number.isSafeInteger(timestamp) ||
    !Number.isSafeInteger(now) ||
    timestamp <= now
  )
    return false;
  const supplied = Buffer.from(sig, 'base64url');
  if (supplied.length !== 32 || supplied.toString('base64url') !== sig)
    return false;
  return timingSafeEqual(supplied, signature(id, expires, secret()));
}
