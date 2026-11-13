# Doorknob

Doorknob is a mobile-first recovery reflection app. Read the daily reflection, speak or type your thoughts, review them, and save a share. Revisit past shares or send an expiring link to another person. No account is required.

## Getting started

Use Node.js 24 LTS, pinned in `.nvmrc`:

```bash
nvm use
npm ci
npm run dev
```

Open http://localhost:3000. Local development uses disposable memory storage and a fictional local reading catalog. Configure a complete catalog if today's date is missing; see [daily readings](docs/READINGS.md). Typing needs no provider credentials. Never commit secrets or personal recovery text.

To enable voice locally, follow [transcription setup](docs/TRANSCRIPTION.md#run-locally). Soniox is the default speech provider; OpenAI is the supported alternative and also provides optional text cleanup. Speech is available once credentials are configured; text cleanup is independently opt-in.

For production, follow the [Terraform and Amplify deployment guide](infra/terraform/README.md). It covers durable storage, the stable signing secret, runtime settings and role permissions. Merging application code does not provision infrastructure.

## Writing and sharing

1. Read the day's reflection and speak or type a response. A draft stays attached to the reading it began with, including across daily rollover.
2. After recording, Stop allows final words to arrive and requests cleanup when enabled. Review the suggested text and edit it freely; AI can change meaning.
3. Choose **Save privately**. Confirmation appears after the server saves the reviewed text and reading snapshot.
4. Open **Past shares** to browse saved entries. History loads on demand and supports **Load more**.
5. Use **Share with fellow alcoholic** to open native sharing or copy the link. Saving never sends the link automatically.

Typing, navigating between app screens, and failed requests preserve the current draft. Refreshing starts a fresh draft. Recording errors retain finalized words. Text is limited to 10,000 Unicode code points.

Private history belongs to the anonymous browser session. Each saved share also has a random UUID bearer link: anyone possessing that link can read the shared reading and thoughts while the link is valid. Recipients cannot browse the sender's history. See [privacy and retention](docs/SECURITY_OPERATIONS.md#privacy-and-retention) for link lifetime, storage, cookie loss and deletion limitations, and [the data glossary](docs/DATA_GLOSSARY.md) for terminology.

The app streams audio directly to the selected speech provider and does not persist raw audio. Cleanup sends finalized draft text to OpenAI. Provider processing and retention are separate from application storage; see [provider controls](docs/SECURITY_OPERATIONS.md#provider-controls-and-exposure).

## Development and operations

```bash
npm run check
```

This runs the local code, contract, test and production-build checks. Browser and DynamoDB integration commands are described in [Contributing](CONTRIBUTING.md#commands). Automated tests use fictional content and mocked providers.

| Document                                             | Owns                                                   |
| ---------------------------------------------------- | ------------------------------------------------------ |
| [Contributing](CONTRIBUTING.md)                      | Setup, commands, testing and dependency maintenance    |
| [Architecture](docs/ARCHITECTURE.md)                 | Feature boundaries, state ownership and server wiring  |
| [API](docs/API.md)                                   | HTTP contracts, sessions and response semantics        |
| [Daily readings](docs/READINGS.md)                   | YAML format, publication and catalog caching           |
| [Transcription](docs/TRANSCRIPTION.md)               | Provider setup, adapters and recording lifecycle       |
| [Security operations](docs/SECURITY_OPERATIONS.md)   | Quotas, cost controls, incident response and retention |
| [Infrastructure](infra/terraform/README.md)          | AWS state, permissions and deployment steps            |
| [Repository standards](docs/REPOSITORY_STANDARDS.md) | Shared tooling and repository policy                   |

The generated OpenAPI contract is available at `/api/openapi.json`; TypeScript route definitions are its source. No application/harness integration or shared data package is implied.
