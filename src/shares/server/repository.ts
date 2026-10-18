import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createShareSchema, reflection, shareSchema } from '../model';

const storedShareSchema = shareSchema.extend({ ownerId: z.uuid() });
/** Server record: ownership is never supplied by the client or returned in JSON. */
export type StoredShare = z.infer<typeof storedShareSchema>;

/** Owner-scoped persistence boundary; all reads enforce ownership. */
export interface ShareRepository {
  create(ownerId: string, text: string): Promise<StoredShare>;
  listByOwner(ownerId: string): Promise<StoredShare[]>;
  findByOwner(id: string, ownerId: string): Promise<StoredShare | null>;
}

// A process global also survives development module reloads and route bundles.
const processState = globalThis as typeof globalThis & {
  doorknobShares?: Map<string, StoredShare>;
};
const shares = (processState.doorknobShares ??= new Map());

/** Local development only: process restarts clear data; replicas do not share it. */
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
