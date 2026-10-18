import { NextRequest } from 'next/server';
import { shareSchema } from '../../../../shares/model';
import { shareRepository } from '../../../../shares/server/repository';
import { error, json, withSession } from '../../../../shares/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Missing shares and shares owned by another session both return 404. */
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
