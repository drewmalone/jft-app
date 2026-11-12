import 'server-only';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { dailyTextSchema, type Reading } from '../model';

export const MAX_CATALOG_BYTES = 10 * 1024 * 1024;
const catalogSchema = z.array(dailyTextSchema).max(3660);
export interface ReadingCatalog {
  byDate: Map<string, Reading>;
}
/** Validate the entire publication before replacing any cached content. */
export function parseCatalog(content: string): ReadingCatalog {
  if (Buffer.byteLength(content) > MAX_CATALOG_BYTES)
    throw new Error('Reading catalog exceeds the size limit.');
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Invalid reading YAML.');
  const parsed = catalogSchema.parse(document.toJS({ maxAliasCount: 100 }));
  const byDate = new Map<string, Reading>();
  for (const text of parsed) {
    if (byDate.has(text.date)) throw new Error('Duplicate reading date.');
    byDate.set(text.date, {
      ...text,
      id: `jft-${text.date}-${createHash('sha256').update(JSON.stringify(text)).digest('hex')}`
    });
  }
  return { byDate };
}
