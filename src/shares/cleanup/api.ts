import { cleanupTextSchema } from './model';

/** One cancellable cleanup request; never retries or saves a share, and never returns provider error details. */
export async function cleanDraft(
  text: string,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch('/api/shares/cleanup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    body: JSON.stringify({ text })
  });
  if (!response.ok) throw new Error('Cleanup unavailable');
  return cleanupTextSchema.parse(await response.json()).text;
}
