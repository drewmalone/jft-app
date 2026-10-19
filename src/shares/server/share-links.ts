import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const processState = globalThis as typeof globalThis & {
  doorknobShareLinkSecret?: string;
};
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
function signature(id: string, key: string) {
  return createHmac('sha256', key).update(`share:v2\n${id}`).digest();
}

/**
 * Signs a saved share ID; lifetime is enforced against the server's saved timestamp.
 * @param id - Owned share UUID, never reflection text.
 * @returns A same-origin relative bearer URL, with no client-supplied expiry.
 * @throws On invalid ID or signing configuration. Never log the result.
 */
export function createShareLink(id: string) {
  uuid.parse(id);
  const sig = signature(id, secret()).toString('base64url');
  return { url: `/s/${id}?sig=${sig}` };
}

/**
 * Authenticates a versioned capability before any repository lookup.
 * @param id - Untrusted share UUID.
 * @param sig - Canonical unpadded base64url SHA256 MAC.
 * @returns False for malformed or tampered capabilities. The public service checks stored age.
 * @throws On invalid server signing configuration; callers must fail closed.
 */
export function verifyShareLink(id: string, sig: unknown) {
  if (
    !uuid.safeParse(id).success ||
    typeof sig !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(sig)
  )
    return false;
  const supplied = Buffer.from(sig, 'base64url');
  if (supplied.length !== 32 || supplied.toString('base64url') !== sig)
    return false;
  return timingSafeEqual(supplied, signature(id, secret()));
}
