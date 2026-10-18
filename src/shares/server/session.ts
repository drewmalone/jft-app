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
function signature(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Invalid credentials are rejected rather than treated as an ownership ID. */
export class InvalidSessionError extends Error {}

/** Read a signed credential or issue a fresh server-generated anonymous identity. */
export function getSession(request: NextRequest) {
  const credential = request.cookies.get(cookieName)?.value;
  if (credential === undefined) {
    const ownerId = randomUUID();
    const expires = Math.floor(Date.now() / 1000) + lifetimeSeconds;
    const payload = `${ownerId}.${expires}`;
    return { ownerId, credential: `${payload}.${signature(payload)}` };
  }
  const parts = credential.split('.');
  const [ownerId, expires, suppliedSignature] = parts;
  if (
    parts.length !== 3 ||
    !z.uuid().safeParse(ownerId).success ||
    !/^\d+$/.test(expires) ||
    !Number.isSafeInteger(Number(expires)) ||
    Number(expires) <= Math.floor(Date.now() / 1000) ||
    !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)
  )
    throw new InvalidSessionError();
  const expected = Buffer.from(signature(`${ownerId}.${expires}`));
  if (!timingSafeEqual(expected, Buffer.from(suppliedSignature))) {
    throw new InvalidSessionError();
  }
  return { ownerId, credential: null };
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
