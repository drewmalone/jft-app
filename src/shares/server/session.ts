import 'server-only';
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const cookieName = 'doorknob-session';
const lifetimeSeconds = 60 * 60 * 24 * 30;
const processState = globalThis as typeof globalThis & {
  doorknobSessionSecret?: Buffer;
};

function secret() {
  const configured = process.env.SESSION_SECRET;
  if (configured && Buffer.byteLength(configured) >= 32) return configured;
  if (process.env.NODE_ENV === 'production' || configured) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  }
  return (processState.doorknobSessionSecret ??= randomBytes(32));
}
// Require canonical encodings before reconstructing the payload for HMAC verification.
const expirySchema = z
  .string()
  .refine((value) => String(Number(value)) === value, 'Expected epoch seconds')
  .transform((value) => Number(value))
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const signatureSchema = z
  .string()
  .refine((value) => {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== 32) return false;
    return decoded.toString('base64url') === value;
  }, 'Expected a base64url SHA-256 signature')
  .transform((value) => Buffer.from(value, 'base64url'));
const credentialSchema = z
  .tuple([z.uuid(), expirySchema, signatureSchema])
  .transform(([ownerId, expiresAt, signature]) => ({
    ownerId,
    expiresAt,
    signature
  }));
type SessionCredential = z.infer<typeof credentialSchema>;
type SessionPayload = Pick<SessionCredential, 'ownerId' | 'expiresAt'>;

/** Session boundary result; the serialized credential is a bearer secret, not share data. */
export type AnonymousSession = {
  /** Verified or server-generated owner; safe to use for repository ownership checks. */
  ownerId: SessionCredential['ownerId'];
  /** New signed cookie value, or null for an existing session. Never log or return in JSON. */
  credential: string | null;
};

function encodePayload(payload: SessionPayload): string {
  return `${payload.ownerId}.${payload.expiresAt}`;
}
function signature(payload: SessionPayload): Buffer {
  return createHmac('sha256', secret()).update(encodePayload(payload)).digest();
}

/**
 * Signals a malformed, expired, or incorrectly signed cookie.
 * withSession maps this to 401 without replacing the cookie or accessing shares.
 * Configuration/crypto failures use ordinary errors and map to 500 instead.
 */
export class InvalidSessionError extends Error {}

/**
 * Verifies an incoming cookie, or creates an identity only when the cookie is absent.
 * Parsing converts the expiry to epoch seconds and the signature to 32 validated bytes
 * before the timing-safe HMAC comparison. Existing sessions have absolute expiry;
 * reading them does not extend their lifetime. This function does not set cookies.
 * @param request - Incoming request containing the untrusted session cookie, if any.
 * @returns The verified/new owner and an optional credential for setSessionCookie.
 * @throws InvalidSessionError for malformed, expired, or forged credentials.
 * @throws When signing configuration is invalid or server crypto operations fail.
 * A nonempty configured secret must contain at least 32 bytes; production requires
 * one. Development otherwise uses a process-global random secret.
 */
export function getSession(request: NextRequest): AnonymousSession {
  const credential = request.cookies.get(cookieName)?.value;
  if (credential === undefined) {
    const payload: SessionPayload = {
      ownerId: randomUUID(),
      expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds
    };
    const signed = signature(payload).toString('base64url');
    return {
      ownerId: payload.ownerId,
      credential: `${encodePayload(payload)}.${signed}`
    };
  }

  const parsed = credentialSchema.safeParse(credential.split('.'));
  if (!parsed.success) throw new InvalidSessionError();

  const session = parsed.data;
  const expired = session.expiresAt <= Math.floor(Date.now() / 1000);
  if (expired) throw new InvalidSessionError();

  const expected = signature(session);
  const supplied = session.signature;
  if (!timingSafeEqual(expected, supplied)) throw new InvalidSessionError();

  return { ownerId: session.ownerId, credential: null };
}

/**
 * Attaches a newly issued host-only cookie to the supplied response in place.
 * Uses HttpOnly, SameSite=Lax, path /, a 30-day Max-Age, and Secure in production.
 * @param response - Response to mutate before returning it to the browser.
 * @param credential - Value issued by getSession; null leaves cookies unchanged.
 * @throws If cookie serialization fails; withSession converts that failure to 500.
 * @remarks Existing sessions are not refreshed. This helper does not verify values;
 * callers must never pass an arbitrary client-provided string as a credential.
 */
export function setSessionCookie(
  response: NextResponse,
  credential: string | null
) {
  if (credential)
    response.cookies.set(cookieName, credential, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: lifetimeSeconds
    });
}
