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

/** Validated identity and a cookie value only when a new session was issued. */
export type AnonymousSession = {
  ownerId: SessionCredential['ownerId'];
  credential: string | null;
};

function encodePayload(payload: SessionPayload): string {
  return `${payload.ownerId}.${payload.expiresAt}`;
}
function signature(payload: SessionPayload): Buffer {
  return createHmac('sha256', secret()).update(encodePayload(payload)).digest();
}

/** Invalid credentials are rejected rather than treated as an ownership ID. */
export class InvalidSessionError extends Error {}

/** Read a signed credential or issue a fresh server-generated anonymous identity. */
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

/** Only a newly issued session sets a cookie; existing credentials are not refreshed. */
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
