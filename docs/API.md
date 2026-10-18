# Private share API

This is the HTTP contract for the Next.js BFF in `jft-app`. It is for the current browser's private shares. There are no public links, share tokens, login endpoints, or client-selected owners. See [architecture](ARCHITECTURE.md) for implementation boundaries and [the README](../README.md#getting-started) for server setup.

## Session and response conventions

The server reads the `doorknob-session` cookie. If it is absent, a supported endpoint creates a random anonymous owner and issues a signed cookie with its response. A malformed, expired, or incorrectly signed cookie produces 401 before accessing shares; it is not silently replaced. Cookie-based clients must retain and resend the cookie. Browser code uses same-origin credentials; nonbrowser clients need a cookie jar.

The cookie is HttpOnly, host-only, SameSite=Lax, and scoped to `/`. It has an absolute 30-day lifetime, with Secure added in production. Successful reads do not refresh its expiry. When the browser drops an expired cookie, its next request starts a new owner; an expired credential explicitly sent by a client receives 401. Tabs sharing site cookies share an owner. Isolation requires separate cookie jars, such as a normal profile and a private profile; multiple private windows may share cookies with one another.

Signing prevents tampering; it does not encrypt the payload. The cookie contains the owner UUID and expiry and must be treated as a bearer credential. Do not log it, commit a cookie jar, or put it in an API body or URL. The `ownerId` field is omitted from share JSON; the UUID in the signed cookie is not a secret identifier on its own.

All responses produced by the supported handlers are JSON with `Cache-Control: private, no-store`. Responses are returned directly as a share or an array; there is no `data` wrapper. Errors have this shape:

```json
{
  "error": {
    "message": "Share not found."
  }
}
```

Messages are intended for display. Branch on the HTTP status rather than matching message text. Next.js handles unsupported HTTP methods itself; its framework-generated responses are outside this error-envelope contract.

## Create a share

`POST /api/shares`

Send `Content-Type: application/json` and a JSON object containing only `text`:

```json
{
  "text": "A fictional thought.\nOne small step."
}
```

The server trims surrounding whitespace and rejects empty/whitespace-only text, nonstrings, missing text, and extra fields. `ownerId`, `id`, `createdAt`, `kind`, and `reflection` are not accepted input fields. The session establishes ownership; the server supplies UUID, UTC ISO creation timestamp, `kind: 'text'`, and the current fixed reading snapshot. Snapshotting happens when the server saves, so changing the reading later does not alter existing records.

Success is **201 Created** with a share. The following example uses fictional text and the current placeholder reading; the ID and timestamp are illustrative:

```json
{
  "id": "95eff0e1-bca7-4fd1-83d2-42ba330aab22",
  "createdAt": "2026-10-18T12:00:00.000Z",
  "kind": "text",
  "text": "A fictional thought.\nOne small step.",
  "reflection": {
    "id": "acceptance-2025-04-23",
    "date": "2025-04-23",
    "title": "Acceptance is the answer to all my problems today.",
    "body": "Today, I can practice meeting life as it is. Acceptance gives me room to pause, let go of what I cannot change, and take one small step toward what I can."
  }
}
```

`reflection.date` is a calendar date, distinct from the creation timestamp. [Shared Zod schemas](../src/shares/model.ts) define the runtime field contract. The [server repository](../src/shares/server/repository.ts) additionally stores `ownerId`; the handlers project records to the owner-visible schema before responding.

## List private shares

`GET /api/shares`

Success is **200 OK** with an array of this session's shares, newest creation timestamp first. No shares is `[]`, not an error. The Map implementation orders equal timestamps by newest insertion first. There are no query filters, pagination, or owner-selection parameters; ownership always comes from the verified cookie.

## Read one private share

`GET /api/shares/:id`

Success is **200 OK** with the same share shape as creation. The ID selects a record but grants no access by itself. IDs with no corresponding record (including non-UUID strings) and IDs belonging to a different owner all return **404 Not Found** with the same error message. Session validation runs first, so invalid credentials return 401 even for an unknown ID.

## Status reference

| Status | Meaning                                                                    | Client action                                                                                |
| ------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 200    | List/detail succeeded                                                      | Render the response; only a successfully loaded empty array means empty history              |
| 201    | Server confirmed creation                                                  | Show confirmation and clear the saved draft                                                  |
| 400    | POST JSON cannot be parsed, text is invalid, or extra fields were supplied | Correct the input; keep the draft                                                            |
| 401    | Cookie is malformed, expired, or incorrectly signed                        | Explain lost session access; clearing site cookies starts a new owner and loses prior access |
| 403    | POST supplied a foreign Origin                                             | Use the same origin; check proxy Host/protocol preservation for a legitimate deployment      |
| 404    | Detail record is missing or inaccessible to this owner                     | Keep history available and report that the share cannot be opened                            |
| 415    | POST content type is unsupported                                           | Send application/json                                                                        |
| 500    | Signing configuration, repository, or another internal operation failed    | Keep the draft and retry after resolving the server/connection problem                       |

401 and 500 can occur on every supported endpoint. POST requires JSON and compares a supplied Origin to the browser-facing Host and request protocol. A missing Origin is allowed for nonbrowser clients. There is no cross-origin API/CORS support. Deploy behind HTTPS and a proxy that preserves or correctly supplies the original Host and protocol; do not rewrite these to an unrelated internal hostname.

A new session cookie can accompany a returned POST validation error because the wrapper establishes a session first. Exceptions caught by the wrapper return an error without attaching a new cookie. [Session/HTTP helpers](../src/shares/server/http.ts) own this behavior.

## Try it locally

Start `npm run dev` in one terminal. In another terminal, run the following with fictional text only. This uses the existing Node.js runtime to extract the generated ID; no additional API tool is required beyond curl.

```bash
doorknob_base_url=http://localhost:3000
doorknob_cookie_jar="$(mktemp)"

doorknob_created_share="$(curl --silent --show-error --fail-with-body \
  --cookie "$doorknob_cookie_jar" --cookie-jar "$doorknob_cookie_jar" \
  --header 'Content-Type: application/json' \
  --data '{"text":"A fictional thought. One small step."}' \
  "$doorknob_base_url/api/shares")"
printf '%s\n' "$doorknob_created_share"

doorknob_share_id="$(printf '%s' "$doorknob_created_share" | \
  node -e 'let body = ""; for await (const chunk of process.stdin) body += chunk; console.log(JSON.parse(body).id)')"

curl --silent --show-error --fail-with-body \
  --cookie "$doorknob_cookie_jar" "$doorknob_base_url/api/shares"
curl --silent --show-error --fail-with-body \
  --cookie "$doorknob_cookie_jar" "$doorknob_base_url/api/shares/$doorknob_share_id"

# A separate client without this cookie cannot access the first owner's share: 404.
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  "$doorknob_base_url/api/shares/$doorknob_share_id"

# Delete the temporary bearer credential when finished.
rm -- "$doorknob_cookie_jar"
```

The first POST issues the cookie; subsequent requests use it. On a browserless HTTP production-mode run, curl will not send a Secure cookie over arbitrary plain HTTP hosts. Use the development server for this example, or HTTPS for a hosted server.

## Retention and failed-write semantics

Records survive requests only in the same Node process. Restarting that process clears them. Replicas/serverless instances do not share the Map; this is not durable deployment storage. Cookie removal, cookie expiry, and signing-key changes lose access but do not delete records from the running Map. There is no delete endpoint or automatic record expiry; the Map retains records until the process exits. See [data lifecycle](DATA_GLOSSARY.md#app-data-lifecycle).

There are no idempotency keys or automatic retries. If the server commits but its response is lost, a client sees a failed request despite a stored share. Check history before retrying an ambiguous write if duplicate text matters. UI duplicate prevention blocks repeated submissions only while a save is pending. Do not describe a rejected fetch as proof that no write occurred.
