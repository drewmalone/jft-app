# Doorknob v0.1

A small, mobile-first text reflection app built with Next.js App Router, TypeScript, and Tailwind CSS. Requires Node.js 20.9+ and npm.

## Run locally

```sh
npm ci
npm run dev
```

Open http://localhost:3000. For a production run: `npm run build` followed by `npm start`.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

Manual browser checks:

1. Confirm a blank or whitespace-only share cannot be saved.
2. Write a multiline share and choose **Save privately**. Check the confirmation and full text.
3. Open **Past shares**, refresh, and open the saved entry. Save another and check newest-first ordering.
4. Check the flow at phone and desktop widths, including keyboard navigation.
5. Block site storage or simulate a quota error: saving should show an error and preserve the draft, without showing a success confirmation.
6. Set `doorknob.shares.v1` to malformed JSON in browser storage: reload and confirm the error is shown and data is not overwritten on save.

## Implementation

- `app/page.tsx`: writing, confirmation, history, and full-share views in one small client component. Navigating between views preserves an unfinished draft.
- `lib/shares.ts`: versioned localStorage key, validated share records, unique IDs, ISO creation timestamps, and newest-first ordering. Each record stores a reflection snapshot and an explicit `kind: 'text'` discriminator that can support future record types without implementing them now.
- `app/globals.css`: warm ivory, navy, serif typography, comfortable text entry, responsive spacing, and visible keyboard focus.
- `tests/shares.test.ts`: empty input, IDs, timestamps, storage round trips, ordering, and malformed data checks.

The reading and its April 23, 2025 date are deliberately hardcoded. The reflection body is original placeholder copy. Saves are local to the current browser and origin. Clearing site data removes them. Browser storage is not encrypted or backed up. There are no accounts, server storage, audio, AI, or social features.
