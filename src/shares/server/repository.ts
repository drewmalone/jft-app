import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createShareSchema, reflection, shareSchema } from '../model';

const storedShareSchema = shareSchema.extend({ ownerId: z.uuid() });
/**
 * Persisted share and its anonymous owner, for server-side use only.
 * Route handlers project this to the shared Share schema before returning JSON.
 */
export type StoredShare = z.infer<typeof storedShareSchema>;

/**
 * Persistence boundary for private shares; every operation is scoped to an owner.
 * Callers must obtain owner IDs from getSession, never from request bodies.
 * Implementations return detached records so callers cannot mutate storage.
 */
export interface ShareRepository {
  /**
   * Validates and trims text, generates metadata, and stores the current reading snapshot.
   * @param ownerId - UUID from a verified or newly issued anonymous session.
   * @param text - Written share; surrounding whitespace is removed.
   * @returns The stored record, including server-only ownership and generated metadata.
   * @throws When owner/text validation or server UUID generation fails. Validation failures
   * occur before writing; persistence failures must be propagated to the caller.
   */
  create(ownerId: string, text: string): Promise<StoredShare>;
  /**
   * Lists only this owner's shares, ordered by creation timestamp descending.
   * @param ownerId - Identity from the session boundary; no client ownership override.
   * @returns Detached records, or an empty array when this owner has no shares.
   * @throws If the persistence implementation cannot complete the read.
   */
  listByOwner(ownerId: string): Promise<StoredShare[]>;
  /**
   * Looks up a private share without revealing whether another owner has that ID.
   * @param id - Share ID selected by the client; possession alone grants no access.
   * @param ownerId - Identity from the session boundary.
   * @returns A detached record, or null for both missing IDs and ownership mismatches.
   * @throws If the persistence implementation cannot complete the read.
   */
  findByOwner(id: string, ownerId: string): Promise<StoredShare | null>;
}

// A process global also survives development module reloads and route bundles.
const processState = globalThis as typeof globalThis & {
  doorknobShares?: Map<string, StoredShare>;
};
const shares = (processState.doorknobShares ??= new Map());

/**
 * Process-global Map implementation for local development, shared across route bundles.
 * Reads clone records; equal timestamps retain newest insertion first. Restarts erase
 * all records, and replicas/serverless instances do not share or synchronize this Map.
 */
export const shareRepository: ShareRepository = {
  async create(ownerId, text) {
    const input = createShareSchema.parse({ text });
    const share = storedShareSchema.parse({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      kind: 'text',
      text: input.text,
      reflection: { ...reflection },
      ownerId
    });
    shares.set(share.id, share);
    return structuredClone(share);
  },
  async listByOwner(ownerId) {
    return structuredClone(
      [...shares.values()]
        .filter((share) => share.ownerId === ownerId)
        .reverse()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    );
  },
  async findByOwner(id, ownerId) {
    const share = shares.get(id);
    return share?.ownerId === ownerId ? structuredClone(share) : null;
  }
};
