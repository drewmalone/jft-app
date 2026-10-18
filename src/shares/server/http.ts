import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, InvalidSessionError, setSessionCookie } from './session';

/**
 * Serializes a supported endpoint response with Cache-Control: private, no-store.
 * @param body - JSON-serializable response data; callers must omit ownership/credentials.
 * @param status - HTTP status, defaulting to 200.
 * @returns A JSON response with the supplied status and private cache policy.
 * @throws When the body cannot be serialized or response construction fails.
 */
export function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  });
}

/**
 * Creates the shared JSON error envelope without exposing exception details.
 * @param message - User-facing message; never include private text or credentials.
 * @param status - Error HTTP status chosen by the endpoint/session boundary.
 * @returns A private, uncached response containing error.message.
 * @throws When response construction fails, such as an invalid HTTP status.
 */
export function error(message: string, status: number) {
  return json({ error: { message } }, status);
}

/**
 * Establishes a trusted owner before invoking an endpoint's repository work.
 * @param request - Incoming request whose cookie must be verified or newly issued.
 * @param action - Endpoint operation, called only after session validation succeeds.
 * @returns The action response with any newly issued cookie; invalid credentials
 * produce 401, and configuration/action failures produce a generic 500. These
 * errors are handled here rather than escaping to the Route Handler. Invalid
 * credentials are not silently replaced; no private text is logged.
 * @remarks For a new session, the cookie is also attached to validation-error
 * responses returned by action. Thrown failures are caught before cookie attachment.
 */
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
