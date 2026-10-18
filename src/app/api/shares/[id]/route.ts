import { NextRequest } from 'next/server';
import { shareSchema } from '../../../../shares/model';
import { shareRepository } from '../../../../shares/server/repository';
import { error, json, withSession } from '../../../../shares/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Retrieves a private share only after verifying the cookie and record ownership.
 * @param request - Incoming request containing the anonymous session cookie.
 * @param context - App Router's asynchronous params; id selects a record, not an owner.
 * @returns 200 with owner-visible Share JSON; identical 404 errors for missing/foreign
 * records, 401 for invalid credentials, or generic 500 for internal failures.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withSession(request, async (ownerId) => {
    const { id } = await context.params;
    const share = await shareRepository.findByOwner(id, ownerId);
    return share
      ? json(shareSchema.parse(share))
      : error('Share not found.', 404);
  });
}
