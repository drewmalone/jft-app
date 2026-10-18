import { NextRequest } from 'next/server';
import { createShareSchema, shareSchema } from '../../../shares/model';
import { shareRepository } from '../../../shares/server/repository';
import { error, json, withSession } from '../../../shares/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List only this anonymous session's private shares, newest first. */
export async function GET(request: NextRequest) {
  return withSession(request, async (ownerId) =>
    json(
      (await shareRepository.listByOwner(ownerId)).map((share) =>
        shareSchema.parse(share)
      )
    )
  );
}

/** Validate text and create metadata, ownership, and reading snapshot server-side. */
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
