# Architecture

Doorknob v0.2 keeps the React frontend and Next.js Backend for Frontend (BFF) in `jft-app`. App Router Route Handlers run in Node.js. There is no separately deployed backend, database, ORM, authentication framework, or external persistence.

## Responsibilities

- `src/app/page.tsx` and `layout.tsx` supply the route entry, metadata, and shared styling. Existing mobile-first components, logo, ivory/navy palette, focus styles, and typography remain in place.
- `src/shares/share-app.tsx` owns screens, the unsaved React draft, requests, heading focus, and loading/error state. Request counters prevent stale history/detail responses from changing newer screens or results. A ref prevents duplicate submits synchronously; a pending state disables editing and the save button. History is fetched on mount to establish a session before saving and refreshed when entering Past shares.
- `src/shares/components/` presents the reading, form, history, and detail. `src/components/` owns the header/footer. Presentation components do not access persistence.
- `src/shares/api.ts` uses browser `fetch` with same-origin credentials and no caching. It validates responses with shared Zod schemas. It sends only text on creation and fetches details by ID instead of opening a cached history record.
- `src/shares/model.ts` owns the placeholder reading and shared input/response schemas. Types are inferred from Zod. The strict creation schema rejects client metadata and ownership fields. Response parsing omits server ownership.
- `src/app/api/shares/route.ts` implements list/create; `[id]/route.ts` implements detail. Both are dynamic Node routes. The POST attaches metadata and a reflection snapshot on the server.
- `src/shares/server/repository.ts` defines a small asynchronous, owner-scoped `ShareRepository` and its Map implementation. Creation validates and trims text, generates metadata, and captures the reading. Every retrieval takes an owner ID, so there is no unscoped private lookup. Returned records are cloned to prevent callers mutating stored snapshots.
- `src/shares/server/session.ts` handles anonymous signed cookies. `http.ts` centralizes session enforcement, private/no-store JSON responses, and consistent errors. These modules import `server-only` to prevent client bundling.
- `src/shares/dates.ts` preserves saved timestamp/local timezone and reading calendar date/UTC behavior.

## HTTP contract

| Endpoint              | Success                        | Errors                                                                                      |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `POST /api/shares`    | 201, created share             | 400 invalid JSON/text or extra fields; 415 unsupported content type; 403 cross-origin write |
| `GET /api/shares`     | 200, owner shares newest first | Session or internal errors                                                                  |
| `GET /api/shares/:id` | 200, owner share               | 404 missing or owned by someone else                                                        |

Request body: `{ "text": "A fictional thought." }`. The response share contains `id`, `createdAt`, `kind: 'text'`, `text`, and `reflection` (ID, date, title, body). The stored record additionally contains `ownerId`; this is never returned. Lists are JSON arrays. Errors use `{ "error": { "message": "..." } }`. Invalid session credentials return 401 on every endpoint. Unexpected failures return a generic 500 without logging private text. Every response uses `Cache-Control: private, no-store`.

## Anonymous session boundary

On the first API request without a session cookie, the server creates a random UUID owner and signs `<owner UUID>.<expiry epoch seconds>` with HMAC-SHA256. The cookie contains the payload and signature, lasts 30 days, is HttpOnly and SameSite=Lax, and is Secure in production. It is host-only with path `/`. No client ownership parameter is trusted. Existing credentials require valid structure, an unexpired timestamp, and a timing-safe comparison of equal-length signatures. Malformed, forged, and expired cookies are rejected rather than silently granting a new identity.

Production requires a `SESSION_SECRET` of at least 32 bytes (generate it randomly). Development uses a process-global random secret unless one is configured. Invalid configuration fails closed with a generic server error. No fallback production secret is used. POST requires JSON and rejects a supplied foreign Origin; SameSite cookies provide an additional browser boundary. Deploy behind HTTPS, preserving the request origin.

The cookie is a bearer credential. This milestone provides browser-session isolation without login, recovery, cross-device access, revocation, or public sharing tokens. Clearing cookies or expiration loses access to existing shares. The server does not delete those records merely because the cookie is removed. A changed signing secret also invalidates old sessions. The frontend displays session errors; clearing site cookies starts a fresh session with no prior access.

## Save and read flow

1. Load history and establish a session. Drafts remain in React state.
2. POST only the text. Zod rejects empty/whitespace input and client-supplied metadata. The server associates the validated owner, captures the current placeholder reading, generates UUID/time, and stores a record.
3. Only a confirmed successful response clears the draft and displays the saved share. Failures retain the draft. Pending saves prevent duplicate submissions within the UI.
4. Past shares fetches fresh, newest-first history. Loading, empty, and failed results are distinct; errors offer retry.
5. Opening an entry fetches its current owner-checked detail. Missing and unauthorized IDs both return 404. Detail request failures keep history available.

A network failure after the server commits can leave the client uncertain whether a write succeeded. This milestone has no idempotency key; UI duplicate prevention applies while a request is pending. Refresh history before retrying an ambiguous failed write if avoiding duplicate text matters.

## Persistence boundary and limitations

The Map and development secret are attached to `globalThis` to survive module reloads and separate route bundles within the same Node process. Requests in that process share the data. The repository methods are asynchronous to allow replacing their implementation with a database later; there is no factory or dependency injection framework.

**Restarting the process clears all shares. This is local development storage, not reliable persistence on Vercel or other serverless infrastructure.** Replicas and workers have separate memory; no synchronization, backup, disk writes, or durability exists. The Map grows for the life of the process. A future durable implementation must retain ownership checks and explicit privacy/retention rules.

v0.1 browser persistence, compatibility fixtures, and storage-only tests are removed. There is no migration or import. No v0.3 public links or signed sharing tokens are implemented.

## Verification

[CONTRIBUTING.md](../CONTRIBUTING.md#commands) owns verification commands. `npm run check` includes formatting, lint, Node tests, and the production build/type check. The Node suite enables the `react-server` export condition so server-only modules can be tested without weakening their client boundary. Tests run without child-process isolation so individual tests execute with the TypeScript loader on Node 24.

Node tests cover schemas, route handlers, repository snapshots, server-generated metadata, sorting, missing shares, session isolation, invalid credentials, and cross-origin writes. Playwright runs mobile/desktop Chromium against a production build on port 3100 with an isolated synthetic secret. It covers save/reload/detail, heading focus, ordering, draft retention, pending submission behavior, API failures, loading, and empty history. No live feeds or external services are called. Manual layout/keyboard review and server-restart checks remain useful; automated browser coverage does not establish full accessibility conformance.

## Intended mobile direction

React Native with Expo remains an option to evaluate for a future native client. Keep shared schemas independent of React, server storage behind the repository, and web components/navigation specific to this frontend. A native client will need an explicit session credential design; do not assume browser cookies transfer unchanged. Extract a shared package only when another client demonstrates reuse. This milestone adds no native skeleton, audio fields, or harness integration.

## Temporary dependency override

Next.js 15.5.28 pins PostCSS 8.4.31, affected by GHSA-6g55-p6wh-862q and GHSA-r28c-9q8g-f849. The scoped npm override uses PostCSS `^8.5.30` within major 8. Remove it when Next.js directly depends on a patched version; do not suppress dependency checks.
