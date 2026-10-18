import { NextRequest } from 'next/server';
import { createShareSchema, shareSchema } from '../../../shares/model';
import { shareRepository } from '../../../shares/server/repository';
import { error, json, withSession } from '../../../shares/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lists only the validated anonymous session's shares; no owner filter is accepted.
 * @param request - Incoming request used to establish or verify the session cookie.
 * @returns 200 with newest-first Share JSON (possibly empty); 401 for invalid session
 * credentials, or generic 500 for internal failures. Responses are private/no-store.
 */
export async function GET(request: NextRequest) {
  return withSession(request, async (ownerId) =>
    json(
      (await shareRepository.listByOwner(ownerId)).map((share) =>
        shareSchema.parse(share)
      )
    )
  );
}

/**
 * Creates a text share with server-generated metadata, ownership, and reading snapshot.
 * @param request - JSON body containing only text; supplied Origin must match the
 * browser-facing Host and request protocol. Deployment proxies must preserve these.
 * @returns 201 with owner-visible Share JSON; 400 for JSON/body validation, 403 for
 * a foreign Origin, 415 for unsupported content type, 401 for invalid credentials,
 * or generic 500 for internal/configuration failures. withSession handles failures;
 * unsuccessful responses never report a successful save.
 */
export async function POST(request: NextRequest) {
  return withSession(request, async (ownerId) => {
    const origin = request.headers.get('origin');
    // Next.js may build nextUrl with its listening hostname (for example 0.0.0.0).
    // Host represents the browser-facing authority on a direct or trusted-proxy request.
    const authority = request.headers.get('host') ?? request.nextUrl.host;
    const expectedOrigin = `${request.nextUrl.protocol}//${authority}`;
    if (origin && origin !== expectedOrigin)
      return error('Cross-origin requests are not allowed.', 403);
    if (
      request.headers.get('content-type')?.split(';')[0].trim() !==
      'application/json'
    ) {
      return error('Send the share as application/json.', 415);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error('Invalid JSON body.', 400);
    }
    const input = createShareSchema.safeParse(body);
    if (!input.success)
      return error(
        'Provide non-empty share text without additional fields.',
        400
      );
    const share = await shareRepository.create(ownerId, input.data.text);
    return json(shareSchema.parse(share), 201);
  });
}
