import 'server-only';
import { publicShareSchema } from '../model';
import { shareRepository, type ShareRepository } from './repository';
import { verifyShareLink } from './share-links';

const lifetimeMs = 7 * 24 * 60 * 60 * 1000;

/**
 * The public authorization boundary: verify before an unscoped repository read.
 * @param id - Untrusted record ID.
 * @param sig - Untrusted signature.
 * @param repository - Defaults to the process store; tests may supply an isolated store.
 * @param now - Server time in Unix milliseconds, injectable for deterministic age tests.
 * @returns Only the reading snapshot and text, or null for every unavailable capability.
 * @throws On invalid server configuration or repository failure; never returns private fields.
 */
export async function readPublicShare(
  id: string,
  sig: unknown,
  repository: ShareRepository = shareRepository,
  now = Date.now()
) {
  if (!verifyShareLink(id, sig)) return null;
  const stored = await repository.findById(id);
  if (!stored) return null;
  const age = now - Date.parse(stored.createdAt);
  if (!Number.isFinite(age) || age < 0 || age >= lifetimeMs) return null;
  return publicShareSchema.parse(stored);
}
