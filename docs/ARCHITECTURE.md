# Application architecture

Doorknob is a single Next.js application. Next.js hosts pages and thin Route Handler adapters; a shared Hono/OpenAPI application dispatches the HTTP operations. AWS and AI providers are accessed through explicit adapters, without a separate backend deployment.

## Feature boundaries

```text
src/
  app/                    Next.js pages and thin API adapters
  components/             Shared presentation
  config/                 Pure validation of deployment settings and quota policy
  http/                   Browser HTTP client and shared error contracts
  server/
    app.ts                API registration and common response privacy headers
    services.ts           Lazy construction of storage, readings and quota services
    http/                 Server middleware, contracts and HTTP error translation
    abuse/                Quota service, backend adapters and aggregate metrics
  session/                Anonymous-session bootstrap, signer and browser readiness
  readings/               Catalog domain, cache, sources, API operation and browser refresh
  shares/                 Drafting, saving, history, public links and provider adapters
```

Shared code lives outside feature directories. Readings use `http/client.ts` and register their operation from `readings/server/http/`; they do not depend on the shares API application. The top-level server app imports feature operations and applies shared policy. Feature-specific share method handling stays with share operations.

`config/runtime.ts` validates storage, readings, feature flags, provider names, secret ARN metadata and quota overrides without accessing external services. `config/features.ts` separates transcription and cleanup enablement; `config/quotas.ts` owns the supported per-owner windows. Startup and build preparation use the same validators. Invalid settings fail with sanitized configuration errors.

`server/services.ts` is the wiring boundary. Its factory can receive explicit settings and isolated state in tests. Production getters lazily construct the chosen repository, reading cache and quota backend. Catalogs, AWS data and provider secrets are not fetched during construction or build. Feature facades preserve a narrow repository/readings interface; they do not select their own infrastructure. Speech provider selection remains fixed on first initialization. Dynamic emergency control records are checked at request time separately from deployment configuration.

## Session and startup

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant Storage
    Browser->>API: POST /api/session (same origin)
    API-->>Browser: Signed cookie when needed; ready: true
    Note over Browser: Typing and recording are independent of history loading
    Browser->>API: GET /api/shares (when Past shares opens)
    API->>Storage: Query verified owner's history
    Storage-->>API: Bounded page
    API-->>Browser: Owner-visible shares
```

The session operation only signs/verifies the existing cookie format. It returns no owner identifier, does not renew valid sessions, and contacts neither storage nor providers. `session/use-session.ts` serializes startup and explicit retries, including React Strict Mode, before the browser starts operations that depend on an established owner. A history outage cannot turn a ready session into a failed one. Existing share endpoints retain their anonymous-session behavior for API compatibility.

`server/http/middleware.ts` owns same-origin checks, request-scoped ownership and bounded JSON handling. Origin is browser request policy, not an anti-abuse identity. Public reading links and editorial readings never require or establish a private session. See [API conventions](API.md#session-and-response-conventions) for HTTP details and [security operations](SECURITY_OPERATIONS.md) for cookie and retention policy.

## Browser state ownership

- `ShareApp` renders screens, shared navigation and error/status feedback.
- `useShareApplication` coordinates navigation, explicit saves, session readiness, on-demand history and detail requests.
- `useShareDraft` owns draft text and the pinned reading/revision. Its reducer handles editing, recording, reading conflicts, review and confirmed-save reset.
- `useShareComposer` coordinates editor actions with recording and cleanup readiness.
- `useTranscription` owns the mounted recording lifecycle; each provider engine owns capture/transport details behind `TranscriptionEngine`.
- `useShareCleanup` owns one cancellable draft transformation. It applies a result only while its request and source text remain current.
- `useShareHistory` owns page loading, pagination and stale-response suppression. It has no session-bootstrap responsibility.

The mounted application retains drafts across its screens. Recording is scoped to the composer and is disposed when it leaves that screen. Generation checks, synchronous pending guards and AbortSignals protect different races; they are not interchangeable. No global client state framework is needed.

## Readings and saved snapshots

The readings feature loads one validated annual catalog from local YAML or private S3, caches it per process and retains the last valid publication during refresh failures. Browser timezone determines the date. A draft pins the reading it began with; a changed server revision asks the person to review the updated reading before saving again.

`shares/server/application/create-share.ts` validates the selected date/revision against server-owned content and passes its snapshot to the repository. Saved shares retain that snapshot after later catalog edits. [Daily readings](READINGS.md) owns the format, publication and cache details.

## Storage and public sharing boundary

`ShareRepository` provides create, owner-scoped list/detail and ID lookup. Memory and DynamoDB implementations share a contract test. The DynamoDB owner/time index supports bounded, eventually consistent history pages; private detail still verifies ownership. Browser cursors are positions, never authorization.

`shares/server/application/read-public-share.ts` is the sole public-reading policy boundary for both the API and server-rendered recipient page. It validates the bearer UUID, applies link expiry and returns a public projection without ownership/history fields. The page uses static generic metadata. [Security operations](SECURITY_OPERATIONS.md#privacy-and-retention) owns retention, expiry and disclosure policy.

## Quotas and paid services

The pure quota service returns normally on acceptance and throws `QuotaExceeded` for an exhausted window. Backend outages and disabled features also throw. DynamoDB consumes all applicable owner windows in one conditional transaction; the local adapter implements the same outcome model. The service imports neither HTTP response helpers nor Hono exceptions.

`server/http/enforce-quota.ts` translates those domain outcomes into responses and applies the documented failure policy. No application-wide quota counters are present. [Security operations](SECURITY_OPERATIONS.md) owns limits, WAF/resource protections, metrics, cost assumptions and emergency procedures.

Transcription credentials are issued server-side, then audio streams directly from browser to the selected provider. Cleanup sends finalized text through the application to OpenAI independently of speech selection. [Transcription](TRANSCRIPTION.md) owns adapter and recording behavior. Provider specifics remain inside adapters; shared UI code consumes normalized lifecycle and transcript events.

## Contracts and verification

`server/http/openapi.ts` provides shared schemas/headers and API metadata; feature operations own their route contracts and validation. Schemas are cloned before OpenAPI decoration so importing domain models before the HTTP app does not change behavior. Generated YAML is an ignored artifact, not a second contract source.

The test suite combines pure policy/reducer tests, mocked provider tests, shared repository contracts, DynamoDB Local transactions, OpenAPI response validation and browser flows. [Contributing](../CONTRIBUTING.md) owns commands and test conventions. [The Terraform guide](../infra/terraform/README.md) owns infrastructure construction and deployment; application builds never apply Terraform.
