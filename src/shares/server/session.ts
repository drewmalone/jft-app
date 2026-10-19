import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseSigned, serializeSigned } from 'hono/utils/cookie';
import { z } from 'zod';

const cookieName = 'doorknob-session';
const lifetimeSeconds = 60 * 60 * 24 * 30;
const processState = globalThis as typeof globalThis & {
  doorknobSessionSecret?: string;
};

function secret() {
  const configured = process.env.SESSION_SECRET;
  if (configured && Buffer.byteLength(configured) >= 32) return configured;
  if (process.env.NODE_ENV === 'production' || configured) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  }
  return (processState.doorknobSessionSecret ??=
    randomBytes(32).toString('base64'));
}
const payloadSchema = z.strictObject({
  ownerId: z.uuid(),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});
/** Validated owner/absolute expiry payload; types alone do not prove authenticity. */
export type SessionPayload = z.infer<typeof payloadSchema>;

/** Session boundary result; the new payload is server-only signing material. */
export type AnonymousSession = {
  /** Verified or server-generated owner; safe to use for repository ownership checks. */
  ownerId: SessionPayload['ownerId'];
  /** New typed payload for signing, or null for an existing session. Never log or return in JSON. */
  newSession: SessionPayload | null;
};

/**
 * Reuses a verified cookie, or starts a fresh empty owner for missing/stale credentials.
 * This disposable prototype never restores ownership from an invalid cookie.
 * @param request - Incoming request with an optional anonymous-session cookie.
 * @returns Verified ownership, or a new random owner and cookie payload.
 * @throws If signing configuration or cryptographic operations fail; no fallback for bad configuration.
 */
export async function getSession(request: Request): Promise<AnonymousSession> {
  const key = secret();
  const cookie = request.headers.get('cookie') ?? '';
  const verified = (await parseSigned(cookie, key, cookieName))[cookieName];
  if (typeof verified === 'string') {
    let value: unknown;
    try {
      value = JSON.parse(verified);
    } catch {
      /* Invalid old cookie starts a new owner below. */
    }
    const parsed = payloadSchema.safeParse(value);
    if (parsed.success && parsed.data.expiresAt > Math.floor(Date.now() / 1000))
      return { ownerId: parsed.data.ownerId, newSession: null };
  }
  const payload: SessionPayload = {
    ownerId: randomUUID(),
    expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds
  };
  return { ownerId: payload.ownerId, newSession: payload };
}

/**
 * Attaches a newly issued host-only cookie to the supplied response in place.
 * Uses HttpOnly, SameSite=Lax, path /, a 30-day Max-Age, and Secure in production.
 * @param response - Response to mutate before returning it to the browser.
 * @param newSession - Server-created payload from getSession; null leaves cookies unchanged.
 * @throws On payload validation, signing configuration, crypto, or serialization failure; the API returns 500.
 * @remarks Existing sessions are not refreshed. Shape validation does not establish trust;
 * callers must supply server-created payloads, never client-provided ownership.
 */
export async function setSessionCookie(
  response: Response,
  newSession: SessionPayload | null
) {
  if (newSession)
    response.headers.append(
      'Set-Cookie',
      await serializeSigned(
        cookieName,
        JSON.stringify(payloadSchema.parse(newSession)),
        secret(),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: lifetimeSeconds
        }
      )
    );
}
