import { z } from 'zod';
import { shareSchema, type Share } from './model';

async function request(path: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin'
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const failure = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(body);
    throw new Error(
      failure.success ? failure.data.error.message : 'Please try again.'
    );
  }
  return body;
}

let pendingHistory: Promise<Share[]> | undefined;

/** Load current history from the BFF; rejects HTTP and invalid response errors. */
export async function readShares() {
  // Coalesce initial reads, including React Strict Mode, so one cookie is issued.
  pendingHistory ??= request('/api/shares')
    .then((body) => z.array(shareSchema).parse(body))
    .finally(() => {
      pendingHistory = undefined;
    });
  return pendingHistory;
}
/** Save only text; success means the server has confirmed the write. */
export async function saveShare(text: string) {
  return shareSchema.parse(
    await request('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
  );
}
/** Fetch a fresh, ownership-checked detail rather than trusting a history entry. */
export async function readShare(id: string) {
  return shareSchema.parse(
    await request(`/api/shares/${encodeURIComponent(id)}`)
  );
}
