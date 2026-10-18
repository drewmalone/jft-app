import { z } from 'zod';
import { apiErrorSchema, type ApiErrorCode } from './errors';

/** Structured HTTP failure; the controller may branch on code/status without parsing messages. */
export class ShareApiError extends Error {
  /**
   * Preserves a validated API failure for display and programmatic handling.
   * @param code - Stable API identifier, independent of display wording.
   * @param message - Server-supplied safe display message.
   * @param status - HTTP failure status; callers must not automatically retry POST.
   */
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ShareApiError';
  }
}

import { shareSchema, type Share } from './model';

async function request(path: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin'
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const failure = apiErrorSchema.safeParse(body);
    throw new ShareApiError(
      failure.success ? failure.data.error.code : 'INTERNAL_ERROR',
      failure.success ? failure.data.error.message : 'Please try again.',
      response.status
    );
  }
  return body;
}

let pendingHistory: Promise<Share[]> | undefined;

/**
 * Fetches and validates this browser session's newest-first history.
 * @returns Server-ordered shares, or an empty array for an owner with no shares.
 * Concurrent calls share one pending read, including initial session-cookie issuance;
 * the pending promise is discarded after either success or failure.
 * @throws On network failure, non-2xx status, invalid JSON, or a schema mismatch.
 * A structured API error's message is retained for the controller to display.
 */
export async function readShares() {
  // Coalesce initial reads, including React Strict Mode, so one cookie is issued.
  pendingHistory ??= request('/api/shares')
    .then((body) => z.array(shareSchema).parse(body))
    .finally(() => {
      pendingHistory = undefined;
    });
  return pendingHistory;
}
/**
 * Posts text only; the server supplies ownership, ID, timestamp, and reading snapshot.
 * @param text - Draft to save; server validation trims it and rejects blank input.
 * @returns The validated share after the server confirms creation.
 * @throws On network/HTTP failure, invalid JSON, or an invalid share response.
 * Rejection does not prove no write occurred: a response can be lost after commit.
 * This helper neither clears the draft nor retries; the controller owns those choices.
 */
export async function saveShare(text: string) {
  return shareSchema.parse(
    await request('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
  );
}
/**
 * Fetches a fresh share through the ownership-checked detail endpoint.
 * @param id - Share ID, encoded as one URL path segment; it is not an access token.
 * @returns The server-validated share for the current anonymous session.
 * @throws On URL encoding/network/HTTP failure (including 404), invalid JSON, or schema mismatch.
 * The API intentionally treats missing IDs and other owners' IDs identically.
 */
export async function readShare(id: string) {
  return shareSchema.parse(
    await request(`/api/shares/${encodeURIComponent(id)}`)
  );
}
