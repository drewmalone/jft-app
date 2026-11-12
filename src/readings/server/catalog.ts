import 'server-only';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { dailyTextSchema } from '../model';

export const MAX_CATALOG_BYTES = 10 * 1024 * 1024;
const catalogSchema = z.array(dailyTextSchema).max(366);
type CatalogEntry = z.infer<typeof dailyTextSchema> & { revision: string };
export interface ReadingCatalog {
  byDay: Map<string, CatalogEntry>;
}
/** Validate the entire publication before replacing any cached content. */
export function parseCatalog(content: string): ReadingCatalog {
  if (Buffer.byteLength(content) > MAX_CATALOG_BYTES)
    throw new Error('Reading catalog exceeds the size limit.');
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Invalid reading YAML.');
  const parsed = catalogSchema.parse(document.toJS({ maxAliasCount: 100 }));
  const byDay = new Map<string, CatalogEntry>();
  for (const text of parsed) {
    if (byDay.has(text.date)) throw new Error('Duplicate reading date.');
    byDay.set(text.date, {
      ...text,
      revision: createHash('sha256').update(JSON.stringify(text)).digest('hex')
    });
  }
  return { byDay };
}
