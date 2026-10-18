# Architecture

Doorknob groups code by responsibility, with the share feature kept together. Next.js route files are entry points; browser state, presentation, and persistence have separate owners. There is no global state library, service framework, or external integration.

## Responsibilities

- **`src/app/page.tsx`** is the server-rendered route entry. It renders the interactive share experience without a content-injection prop.
- **`src/app/layout.tsx`** supplies page metadata and the shared stylesheet.
- **`src/app/globals.css`** supplies the ivory and navy palette, serif typography, responsive spacing, and focus styles alongside Tailwind utilities.
- **`src/shares/share-app.tsx`** is the client boundary. It owns the current screen, draft, history, loading/error feedback, and heading focus. The screen state carries a share only for saved/detail views, so those views cannot exist without the record they display.
- **`src/shares/components/`** contains the reading, form, history, and detail presentation components. Props express their inputs and callbacks; they do not access storage. The share controller composes the reading directly. Components imported by the client boundary run as part of its client tree without redundant `use client` directives.
- **`src/shares/shares.ts`** owns the fixed reading, versioned storage key, creation, and Zod schemas. Share and reflection types are inferred from those schemas, keeping the TypeScript and runtime contracts together. Unknown fields are preserved for forward compatibility; invalid records still fail without overwriting history. It has no dependency on React or browser storage.
- **`src/shares/storage.ts`** reads and writes validated history. It accepts the small storage API it needs, so error behavior can be tested without a browser. Browser storage is accessed only after mounting or in event handlers.
- **`src/shares/dates.ts`** formats saved timestamps in the reader's local time zone and reading calendar dates in UTC, preventing calendar dates from moving to the previous day.
- **`tests/shares/`** verifies data and persistence contracts. **`tests/e2e/`** checks real user flows in mobile and desktop Chromium.

## Save and read flow

1. The client reads `doorknob.shares.v1` after mounting. Parsing validates every record and orders history by creation timestamp, newest first.
2. Saving trims the draft and rejects empty text. The new record receives a UUID, ISO timestamp, and a copy of the reading.
3. Persistence reads history again immediately before writing to retain recent saves from other tabs when possible. localStorage does not provide transactional writes, so simultaneous saves across tabs can still race.
4. Only a successful storage write updates the in-memory history, clears the draft, and opens the confirmation view.
5. Selecting a history entry opens its full text and original reading snapshot. View changes focus the heading; the form references its help and error messages for assistive technology. Muted text and placeholders use a color with at least 4.5:1 contrast on the ivory background, and the header navigation has a 44px minimum height.

Storage access, parsing, quota, or serialization failures show an error. Failed saves retain the draft. Invalid history is not replaced by an empty array, preventing a subsequent save from silently destroying unreadable records. There is no automatic repair or migration in this milestone.

## Data contract

A share contains `id`, `createdAt`, `kind`, `reflection`, and `text`. The reflection snapshot contains its own ID, date, title, and body, so changing the daily reading does not alter past shares. `kind: 'text'` makes the current record type explicit without unused audio or transcript fields. The versioned storage key leaves room for a deliberate future migration.

## Tradeoffs and boundaries

Views use in-memory navigation without separate URLs or browser-history entries. This keeps draft ownership simple for the current milestone. Refreshing returns to the writing view while saved shares remain available through history. Unsaved drafts are not persisted. If deep links or browser Back navigation become requirements, use Next.js routes rather than adding a second custom routing system.

The daily reading is fixed. System serif fonts avoid external font requests. Storage is limited to the current origin and device, without encryption, backup, accounts, or synchronization.

Keep components at meaningful UI boundaries. Do not extract every heading, button, or wrapper into a generic component. Introduce a shared component only when repeated behavior or styling warrants an owner. Local state is sufficient here; no context provider, reducer framework, or server-state library is needed.

## Verification

[CONTRIBUTING.md](../CONTRIBUTING.md#commands) owns verification commands and lint/format conventions. The ESLint configuration matches Next.js 15. Its production build checks TypeScript, so no second type check is included in `check`.

`npm run test:e2e` runs Playwright against the production build on port 3100, with isolated storage per test. It covers persistence, full-share reading, newest-first ordering, empty input, heading focus, draft retention, quota failures, and malformed history on mobile and desktop Chromium. CI installs Chromium and runs this after `check`. Firefox, Safari, and complete accessibility conformance are not covered by these tests.

## Guidance behind this organization

Reviewed against official documentation:

- [Next.js project structure](https://nextjs.org/docs/app/getting-started/project-structure): keep framework entry points and feature ownership clear; Next.js does not mandate a universal folder tree.
- [Next.js server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components): browser APIs and interaction belong behind a client boundary. This small feature composes its own reading rather than adding a server-content prop for minimal benefit.
- [React state structure](https://react.dev/learn/choosing-the-state-structure): group state that changes together and avoid contradictory or redundant state.
- [Next.js 15 ESLint configuration](https://nextjs.org/docs/15/app/api-reference/config/eslint): use framework, hooks, accessibility, and TypeScript rules appropriate to the installed version.
- [W3C form instructions](https://www.w3.org/WAI/tutorials/forms/instructions/): provide labels and associate supporting instructions with controls.

These principles inform this small app; they do not require a design system, global state manager, new server layer, or features from later milestones.
