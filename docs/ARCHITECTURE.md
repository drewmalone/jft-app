# Architecture

Doorknob keeps its first milestone in two source groups: the Next.js interface and the share data contract. There are no service layers or external integrations.

## Responsibilities

- **`src/app/page.tsx`** owns the writing, saved confirmation, history, and full-share views. It reads browser history after mounting and keeps view selection, draft text, and the selected share in React state. View changes move keyboard focus to the heading.
- **`src/app/layout.tsx`** supplies page metadata and the shared stylesheet.
- **`src/app/globals.css`** supplies the ivory and navy palette, serif typography, responsive spacing, and focus styles alongside Tailwind utilities.
- **`src/shares/shares.ts`** owns the fixed reading, share type, versioned storage key, record creation, and runtime validation. It has no dependency on React or localStorage.
- **`tests/shares/`** verifies the data contract without requiring a browser.

## Save and read flow

1. The client reads `doorknob.shares.v1` after mounting. Parsing validates every record and orders the history by creation timestamp, newest first.
2. Saving trims the draft and rejects empty text. The new record receives a UUID, ISO timestamp, and a copy of the reading.
3. The client reads history again immediately before writing to retain recent saves from other tabs when possible. localStorage does not provide transactional writes, so simultaneous saves across tabs can still race.
4. Only a successful storage write updates the in-memory history, clears the draft, and opens the confirmation view.
5. Selecting a history entry opens the full saved text and its original reading snapshot.

A storage access, parsing, quota, or serialization failure shows an error. Failed saves retain the draft. Invalid history is not replaced by an empty array, which prevents a subsequent save from silently destroying unreadable records. There is no automatic repair or migration in this milestone.

## Data contract

A share contains `id`, `createdAt`, `kind`, `reflection`, and `text`. The reflection snapshot contains its own ID, date, title, and body, so a future change to the daily reading does not change past shares. `kind: 'text'` makes the current record type explicit without adding unused audio or transcript fields. The storage key includes a version for a future deliberate migration.

## Tradeoffs and boundaries

All views share one page component and use in-memory navigation; they do not have separate URLs or browser-history entries. Refreshing returns to the writing view while saved shares remain available through history. Unsaved drafts are not persisted.

The daily reading is fixed rather than fetched or selected by date. System serif fonts keep the app independent of external font requests. Storage is limited to the current origin and device, without encryption, backup, accounts, or synchronization.

CI covers data tests, production compilation, and TypeScript. Browser interaction and responsive layout were checked separately during implementation and remain documented manual checks. No harness code, AI behavior, or future milestone functionality is included.
