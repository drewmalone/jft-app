import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, InvalidSessionError, setSessionCookie } from './session';

/** Consistent private JSON responses, including errors, must never be cached. */
export function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  });
}

/** Error envelope shared by every endpoint. */
export function error(message: string, status: number) {
  return json({ error: { message } }, status);
}

/** Authenticate before touching the repository; never log private content. */
export async function withSession(
  request: NextRequest,
  action: (ownerId: string) => Promise<NextResponse>
) {
  try {
    const session = getSession(request);
    const response = await action(session.ownerId);
    setSessionCookie(response, session.credential);
    return response;
  } catch (cause) {
    if (cause instanceof InvalidSessionError) {
      const response = error(
        'Your session is invalid or expired. Clear site cookies to start a new session; access to previous shares will be lost.',
        401
      );
      return response;
    }
    return error('The request could not be completed. Please try again.', 500);
  }
}
