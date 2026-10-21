import 'server-only';
import { publicShareSchema } from '../model';
import { shareRepository, type ShareRepository } from './repository';
import { z } from 'zod';

const shareId = z.uuid({ version: 'v4' });

const lifetimeMs = 7 * 24 * 60 * 60 * 1000;

/**
 * The public authorization boundary: validate the bearer UUID before reading storage.
 * @param id - Untrusted record ID.
 * @param repository - Defaults to the process store; tests may supply an isolated store.
 * @param now - Server time in Unix milliseconds, injectable for deterministic age tests.
 * @returns Only the reading snapshot and text, or null for every unavailable link.
 * @throws On repository failure or invalid stored content; never returns private fields.
 */
export async function readPublicShare(
  id: string,
  repository: ShareRepository = shareRepository,
  now = Date.now()
) {
  if (!shareId.safeParse(id).success) return null;
  const stored = await repository.findById(id);
  if (!stored) return null;
  const age = now - Date.parse(stored.createdAt);
  if (!Number.isFinite(age) || age < 0 || age >= lifetimeMs) return null;
  return publicShareSchema.parse(stored);
}
