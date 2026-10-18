# Doorknob v0.1

Doorknob is a mobile-first recovery reflection app. Read a daily reflection, write a text share, save it privately in this browser, and revisit past shares.

## Getting started

Use Node.js **24 LTS**, pinned in `.nvmrc` and required by `package.json`:

```bash
nvm use
npm ci
npm run dev
```

Open http://localhost:3000. No credentials or environment variables are required.

For a production run:

```bash
npm run build
npm start
```

## Writing and reviewing shares

1. Read the reflection and write in the multiline textbox.
2. Choose **Save privately** to see the confirmation and saved text.
3. Open **Past shares** to browse newest first, then select an entry to read it in full.

Blank or whitespace-only shares cannot be saved. Navigating between views preserves an unfinished draft. A failed save keeps the draft and shows an error; malformed stored history is never silently replaced.

The reading and April 23, 2025 date are deliberately hardcoded. The reflection body is original placeholder copy.

## Storage and limitations

Shares live in localStorage under `doorknob.shares.v1`, scoped to the current browser and origin. Each record contains a unique ID, ISO creation timestamp, text, a reflection snapshot, and an explicit `kind: 'text'` discriminator.

Clearing site data removes shares. Browser storage is not encrypted or backed up. Drafts stay in memory until saved and are lost on refresh. Simultaneous writes in multiple tabs are not transactional.

This milestone includes no audio, transcription, AI, authentication, database, server endpoints, or sharing with other people.

## Validation

```bash
npm run check
```

GitHub Actions runs the same `npm run check` command after `npm ci` on pull requests and pushes to `main`. It checks formatting, tests, the production build, and TypeScript. The build generates Next.js route types before the explicit TypeScript check. Tests require no credentials or external services.

Unit tests cover empty input, unique IDs, timestamps, storage round trips, newest-first ordering, and malformed records. Browser validation during implementation covered saving, persistence after refresh, full-share reading, storage errors, malformed storage, and horizontal overflow at 320px, 390px, and 1440px. Those browser checks are not part of `npm test`.

Manual checks:

1. Confirm blank and whitespace-only input cannot be saved.
2. Save a multiline share. Check the confirmation and full text.
3. Refresh, open **Past shares**, and reopen the entry. Save another and confirm newest-first ordering.
4. Check phone and desktop layouts and keyboard navigation.
5. Block site storage or simulate a quota error. Confirm an error appears and the draft remains without a success confirmation.
6. Set `doorknob.shares.v1` to malformed JSON in browser storage. Reload and confirm the error appears and saving does not overwrite the existing value.

## Project layout

Source and tests are grouped by responsibility, with direct imports and no barrel files or path aliases.

```text
src/
  app/              page.tsx, layout.tsx, globals.css — Next.js views and styling
  shares/           shares.ts — reading, share records, creation, and validation
tests/
  shares/           shares.test.ts — share and stored-history contracts
docs/
  ARCHITECTURE.md    view transitions, persistence, and design tradeoffs
.github/workflows/
  checks.yml                  tests, production build, and TypeScript
  conventional-commits.yml    PR title validation
```

See [the architecture](docs/ARCHITECTURE.md) for data flow and implementation decisions.

## Contributing and repository standards

See [CONTRIBUTING.md](CONTRIBUTING.md) for commands, formatting, documentation, and PR conventions. [Shared repository standards](docs/REPOSITORY_STANDARDS.md) records the seven workflow decisions and the copy plan for `jft-harness`, including GitHub settings that still require configuration. [The data glossary](docs/DATA_GLOSSARY.md) defines terminology shared by both repositories.

Dependabot proposes weekly npm and GitHub Actions updates. Dependency Review checks newly introduced high/critical vulnerabilities, and CodeQL scans TypeScript. These workflows do not configure branch protection or repository security features by themselves.
