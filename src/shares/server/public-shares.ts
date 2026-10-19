import 'server-only';
import { publicShareSchema } from '../model';
import { shareRepository, type ShareRepository } from './repository';
import { verifyShareLink } from './share-links';

/**
 * The public authorization boundary: verify before an unscoped repository read.
 * @param id - Untrusted record ID.
 * @param expires - Untrusted canonical expiry; duplicate/missing values fail validation.
 * @param sig - Untrusted signature.
 * @param repository - Defaults to the process store; tests may supply an isolated store.
 * @param now - Unix seconds for deterministic verification tests.
 * @returns Only the reading snapshot and text, or null for every unavailable capability.
 * @throws On invalid server configuration or repository failure; never returns private fields.
 */
export async function readPublicShare(
  id: string,
  expires: unknown,
  sig: unknown,
  repository: ShareRepository = shareRepository,
  now?: number
) {
  if (!verifyShareLink(id, expires, sig, now)) return null;
  const stored = await repository.findById(id);
  return stored ? publicShareSchema.parse(stored) : null;
}
