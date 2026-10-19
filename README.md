# Doorknob v0.3

Doorknob is a mobile-first recovery reflection app. Read a daily reflection, write a text share, save it privately through the Next.js Backend for Frontend (BFF), revisit past shares, and intentionally send an expiring signed reading link to another person.

## Getting started

Use Node.js **24 LTS**, pinned in `.nvmrc`:

```bash
nvm use
npm ci
npm run dev
```

Open http://localhost:3000. Local development needs no credentials: a random session signing secret is generated for the running process. Optionally set `SESSION_SECRET` to a random value of at least 32 bytes in `.env.local`. Never commit secrets or personal recovery text.

For a production-mode local run, create `.env.local` first:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value into `.env.local` as `SESSION_SECRET=<generated value>`, then run:

```bash
npm run build
npm start
```

Production requires both `SESSION_SECRET` and a separate `SHARE_LINK_SECRET` and sets Secure cookies. Generate a second independent random value with the same command and add `SHARE_LINK_SECRET=<second generated value>` to `.env.local` before starting. Missing or short production secrets cause API requests to return a generic 500; the app does not supply a production fallback. A signing-key change invalidates existing cookies. Use HTTPS when hosting; browser handling of Secure cookies on plain HTTP localhost can vary. Use `npm run dev` for ordinary local development.

## Sharing with another person

After saving a share or opening it from **Past shares**, choose **Share with another alcoholic**. This explicitly requests a signed URL; saving alone stays private. Read the access explanation, then use **Copy link** or **Send share**. Device sharing and automatic clipboard access depend on browser support and a secure context. When unavailable or denied, select and manually copy the displayed link. A closed native sharing interface does not confirm delivery.

Anyone holding the link can read the original reading snapshot and written thoughts at `/s/{shareId}?expires=...&sig=...`, without an account or session. They cannot use it to browse private history. Recipients can forward the link, copy the text, or save a screenshot. Treat links as credentials; never paste them into logs, analytics, public issue reports, or Git.

Links expire after seven days by default. There is **no immediate revocation and no delete endpoint** in v0.3. Future deletion of the underlying share will invalidate all its links; no link records or recipient tracking exist. Signing-key changes invalidate every link made with the old key. Expiration only restricts subsequent server access; it cannot recall copies. Restarting the server erases the in-memory shares, so even otherwise-valid links stop working.

### Sharing configuration

| Variable                 | Purpose                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`         | Existing anonymous-cookie key; required in production, at least 32 bytes.                                                                                                                                 |
| `SHARE_LINK_SECRET`      | Independent, cryptographically random signing key of at least 32 bytes; required in production. Must differ from `SESSION_SECRET`. Generate with Node crypto as above. Never use a `NEXT_PUBLIC_` prefix. |
| `SHARE_LINK_TTL_SECONDS` | Optional integer duration, 1–31,536,000 seconds; default 604,800 (seven days). Invalid values fail link creation closed.                                                                                  |

Development without a configured sharing key uses one random process-stable key, including across hot reloads. An explicitly empty/short sharing key fails closed, as does missing production configuration. Signing errors return a generic API 500 without exposing configuration; recipient pages display the unavailable message. No secret is shipped to client code. Next development request logging is disabled so token-bearing URLs are not recorded; configure any hosting proxy/access logging to redact query strings too. No analytics or third-party tracking is used on recipient pages.

### Manual check across two browser sessions

1. Run `npm run dev`; write fictional text and **Save privately** in browser A. Confirm there is no signed link until you choose **Share with another alcoholic**.
2. Copy the generated link, or use **Send share** if supported. Check the expiry and bearer-access explanation.
3. Open the link in a fresh private window or separate browser B. Confirm the reading date/title/body and written thoughts appear without a login. The recipient page has no private-history navigation and creates no session cookie.
4. In browser B, opening the home page and **Past shares** must show its own empty history. Knowing the sender's share ID must not grant private detail access or let B generate new links.
5. Change the ID, `expires`, or `sig`, remove a parameter, or duplicate it. Confirm the public API returns generic 404 and the recipient page says **This share is unavailable**. For an expiry check, start with `SHARE_LINK_TTL_SECONDS=5`, create a new link, wait over five seconds, and reopen it.
6. In A, open the saved entry through **Past shares** and create another link. Test copy permission denial or an unsupported browser; the manual link field stays usable. Cancel native sharing and confirm no delivery claim appears.
7. Restart the server; previous shares and links are unavailable. These checks use fictional content only.

## Writing and reviewing shares

1. Read the reflection and write in the multiline textbox.
2. Choose **Save privately**. Confirmation appears only after the server saves your text.
3. Open **Past shares** to browse newest first, then select an entry to fetch and read it in full.

Blank shares cannot be saved. Text is limited to 10,000 Unicode code points, and the full JSON request is limited to 64 KiB. Oversized-input failures retain the draft for editing. Navigating between views preserves drafts. Failed saves retain your words and show an error. Pending saves disable editing and duplicate submissions. History and detail requests have loading and error feedback; failed history requests can be retried.

The reading and April 23, 2025 date remain deliberate placeholders.

## Persistence and privacy limitations

Shares are sent to the same-origin Next.js server and stored in a process-local Map. Each record has a server-generated UUID, ISO timestamp, `kind: 'text'`, text, reading snapshot, and anonymous owner ID in the server record. Share JSON omits the ownerId field. There is no browser storage persistence or migration of v0.1 test data.

A signed, HttpOnly, SameSite=Lax cookie identifies the anonymous session. It expires after 30 days and is Secure in production. Different browser sessions cannot list or read one another's shares through the private endpoints; an intentionally shared signed link separately grants read access to that share. Invalid or expired credentials receive 401. Choose **Start a new session** in the app to recover if this occurs; **clearing cookies loses access to existing shares**, even while those records remain in server memory. The signed cookie is readable, not encrypted, and must be treated as a bearer credential. Tabs sharing site cookies share an owner; use separate profiles/cookie jars to test isolation. Cookies do not provide login accounts or recovery. Saving waits for a successful initial session read; initialization failures retain the draft and offer retry. Foreign-origin POSTs are rejected before session creation and never replace the cookie. This prototype now uses Hono’s signed-cookie format; use **Start a new session** for a cookie from the earlier development implementation if it receives 401. There is no cookie migration.

**This storage is for local development. Restarting the server clears all shares. Multiple processes, replicas, and serverless instances such as Vercel do not share the Map and cannot provide reliable persistence.** No disk storage, database, encryption at rest, backup, account recovery, or durable deployment is provided. Unsaved drafts live only in React memory and disappear on refresh. The development signing secret also resets on process restart unless configured. There is no per-share deletion or expiry job; cookie loss does not remove records from the running Map. See [the data lifecycle](docs/DATA_GLOSSARY.md#app-data-lifecycle).

Signed sharing links are optional: private saving never creates one automatically. No audio, transcription, AI, registration, real reading feeds, or harness integration are included.

## Validation

```bash
npm run check
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

`check` runs formatting, lint, Node tests, and a production build including TypeScript validation. Browser tests run separately against a production server on port 3100 with a synthetic signing secret. All test content is fictional. If Chromium is not installed:

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

Omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using Playwright's installed browser. Tests validate the generated OpenAPI document and actual responses with Swagger Parser and Ajv. They cover HTTP headers/methods, stable error codes, input-size boundaries, API validation and metadata, ownership/session credential checks, save/reload/detail flows, ordering, API failures, draft retention, duplicate prevention, loading, and empty history in mobile and desktop Chromium.

Manual checks:

1. Confirm blank text cannot be saved. Navigate between views and confirm an unfinished draft remains.
2. Save a multiline share, refresh, and reopen it from **Past shares**.
3. Open a separate private browser session and confirm its history is empty and the first session's share ID returns 404.
4. Simulate a failed POST in browser developer tools; verify the draft remains with no confirmation.
5. Check phone and desktop layouts, keyboard navigation, and heading focus.
6. Restart the server and confirm history is empty. Clear cookies and confirm previous shares are inaccessible.

## Project layout

```text
src/
  app/                  App Router entry, layout, theme
    api/shares/         Next.js exports for private share operations
    api/openapi.json/   generated OpenAPI 3.1 contract
  components/           app-wide header and footer
  shares/
    share-app.tsx       React state, requests, and screen transitions
    api.ts              browser fetch and response validation
    components/         reading, form, history, and detail presentation
    model.ts            shared Zod schemas, inferred types, and text limit
    reflection-fixture.ts fictional daily reading
    errors.ts           shared stable error codes and envelope
    server/
      operations/       create, list, read contracts and typed handlers
      resource-methods.ts HEAD/OPTIONS/405 handling for share resources
      app.ts            operation registration and dispatch
      openapi.ts        shared contract helpers and metadata
    use-share-history.ts History loading and initial session bootstrap
    dates.ts            saved-date formatting
tests/
  shares/               Node tests for schemas, routes, repository, and dates
  e2e/                  Playwright user flows
```

Open http://localhost:3000/api/openapi.json for the generated contract. TypeScript route/Zod definitions are the source of truth. `npm run openapi:lint` generates ignored `.tmp/openapi.yaml` and checks it with Spectral; CI also uploads the YAML as the `openapi` workflow artifact. Generated YAML is not committed.

See [the private API reference and curl example](docs/API.md), [architecture](docs/ARCHITECTURE.md), [contributor commands](CONTRIBUTING.md#commands), [repository standards](docs/REPOSITORY_STANDARDS.md), and [data glossary](docs/DATA_GLOSSARY.md).

## Session recovery

An invalid/expired-session message means the server cannot verify the browser's HttpOnly cookie. This can happen after a development restart (the temporary signing key resets), a signing-key change, cookie expiry, or switching between local servers with different keys on the same hostname. Cookies are scoped to the hostname, not the port. Retrying a read resends the same cookie and cannot repair it.

Choose **Start a new session** when offered. This explicitly replaces rejected credentials through a same-origin POST, then reloads history before enabling saving. Your unsaved draft stays on screen; access to the previous owner is not restored. The action does not delete records or revoke existing sharing links. A valid session is preserved if another tab already recovered it. Network/configuration failures keep saving blocked and offer retry; ordinary private API reads still return 401 for invalid credentials and never silently replace them.

For stable local cookie signing across restarts, configure a random `SESSION_SECRET` in ignored `.env.local` as described above. This does not make shares durable: restarting still clears the in-memory store. Manual recovery check: use an old local cookie after changing the signing key, write a fictional draft, choose **Start a new session**, and confirm the draft remains and can be saved.

## Installation troubleshooting

This project uses public npm packages and does not require npm login. For E401 on a machine configured for a private company registry, try `npm ci --registry=https://registry.npmjs.org/`. Fix installation errors before starting the app. Do not commit registry credentials or change shared company authentication.
