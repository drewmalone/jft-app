# Live transcription and cleanup

Both Soniox and OpenAI remain explicitly supported speech providers; this is an intentional product choice, recorded in [Decisions](DECISIONS.md#speech-provider-support). Soniox (`stt-rt-v6`) is the default speech provider. `STT_PROVIDER=openai` selects the supported WebRTC adapter. The server fixes that choice at startup and passes its nonsecret name to the browser, which needs the matching transport for direct audio streaming. Unknown, empty or whitespace-padded names fail configuration; there is no automatic fallback.

## Runtime configuration

| Variable                                       | Purpose                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `TRANSCRIPTION_ENABLED`                        | Exact `true` enables credential issuance; defaults to false.                                           |
| `CLEANUP_ENABLED`                              | Exact `true` independently enables OpenAI text cleanup; defaults to false.                             |
| `STT_PROVIDER`                                 | `soniox` by default, or `openai`; restart to change.                                                   |
| `STT_SONIOX_API_KEY`                           | Local development key; ignored in production.                                                          |
| `STT_SONIOX_SECRET_ARN`                        | Deployed Soniox plain-string secret metadata; value read by the compute role.                          |
| `STT_OPENAI_API_KEY` / `STT_OPENAI_SECRET_ARN` | OpenAI credentials for cleanup and optional OpenAI speech; existing direct-key precedence is retained. |

Migration: when a canonical feature enable flag is absent, the old `STT_ENABLED` value supplies its default. An explicit `TRANSCRIPTION_ENABLED` or `CLEANUP_ENABLED` wins independently. Prefer the canonical flags in new configuration. The legacy fallback is scheduled for retirement in 0.4 after hosted deployments have migrated; see [the compatibility decision](DECISIONS.md#feature-flag-compatibility-retirement). All enable/disable flags accept only `true` or `false`; invalid values fail validation. [Security operations](SECURITY_OPERATIONS.md#runtime-configuration) owns emergency switches and quota settings.

## Run locally

Use Node 24, run `npm ci`, and create an ignored `.env.local`:

```dotenv
TRANSCRIPTION_ENABLED=true
CLEANUP_ENABLED=true
STT_PROVIDER=soniox
STT_SONIOX_API_KEY=replace-with-your-soniox-key
STT_OPENAI_API_KEY=replace-with-your-openai-key
```

Then run `npm run dev`. No AWS credentials are required for local memory/YAML mode with direct development keys. The optional development session signing secret and production requirements are covered in [the deployment guide](../infra/terraform/README.md).

The Soniox key needs **Temporary API keys** and **Speech-to-text, real-time** permissions. Cleanup needs an OpenAI key with Responses access for `gpt-5.4-mini`; optional OpenAI speech also needs Realtime access. Missing cleanup credentials preserve the original draft. Never use `NEXT_PUBLIC_*` for credentials or run the Amplify preparation script for ordinary local development.

To type and save without paid services, leave both feature enable flags false. To keep cleanup available while stopping speech issuance, set `TRANSCRIPTION_ENABLED=false` and `CLEANUP_ENABLED=true`.

## Recording and text ownership

An explicit Record tap invokes the selected engine only after the private session is ready. The official Soniox recording SDK starts microphone acquisition before asynchronously resolving connection configuration, preserving mobile Safari user activation. It owns capture, temporary in-memory startup buffering, direct WebSocket streaming, graceful Stop and cancellation. OpenAI uses direct WebRTC. Provider details stay behind `TranscriptionEngine`.

`/api/transcription/session` verifies exact origin, an existing signed cookie, feature configuration and per-owner quota before requesting a temporary credential. The browser asserts `X-STT-Provider`; a mismatch returns a safe 503 and requires reload. Missing headers retain legacy OpenAI semantics for compatibility. Permanent keys remain server-side. Credential restrictions, cost exposure and provider-console setup are owned by [security operations](SECURITY_OPERATIONS.md#provider-controls-and-exposure).

Soniox results contain incremental finals and a replacement provisional suffix. Its protocol adapter emits `final(text, 'verbatim')`; the editor inserts a paragraph for a new recording while preserving later fragment whitespace and punctuation. OpenAI retains space-separated segment behavior. Timestamp/text identity suppresses repeated timed finals without dropping repeated words at distinct times; untimed finals follow the provider's incremental contract.

`stop()` releases capture immediately and permits trailing finals. Stop before connection cancels. Disposal silences callbacks and releases late microphone grants. Shared `transcription/session-config.ts` owns startup (20 seconds), finalization (5 seconds) and browser session (10 minutes) deadlines. OpenAI's RTP drain stays inside its adapter. Backgrounding/navigation and external microphone muting interrupt recording. Finalized and typed words remain after errors; provisional words are discarded.

## Independent cleanup

After an explicit Stop successfully finalizes new words, the browser sends the whole finalized draft, including typed text, for optional cleanup. OpenAI `gpt-5.4-mini` returns bounded structured text with reasoning off, `store:false` and no tools. Cleanup adds paragraph breaks and removes obvious fillers without adding advice, translation or interpretation. Review remains necessary because AI can change meaning.

Only explicit Save writes a share. Edits/navigation/unmount cancel pending cleanup, and stale responses cannot overwrite newer words. Cleanup failure leaves the original text available for editing and manual retry. [Privacy and retention](SECURITY_OPERATIONS.md#privacy-and-retention) owns stored-data and provider-processing distinctions.

## Deployment and verification

Follow [the infrastructure runbook](../infra/terraform/README.md) for Secrets Manager, role permissions, runtime preparation and rollout. `scripts/prepare-runtime-env.ts` validates and copies allowlisted nonsecret configuration; keys are never copied into the generated artifact. `server/services.ts` owns infrastructure wiring, while provider adapters resolve their credentials through the shared secret loader.

Sanitized provider diagnostics live in `shares/server/transcription-diagnostics.ts`. OpenAI's opt-in `?speechDebug=1` counters describe WebRTC, not Soniox. Disable them with `?speechDebug=0`. Logging restrictions and aggregate metrics belong to [security operations](SECURITY_OPERATIONS.md#metrics-and-cost).

Automated tests use synthetic microphone/provider boundaries. They do not establish physical-device recognition quality or permission/interruption behavior. Use [the device checklist](MICROPHONE_TESTING.md) on iPhone Safari and Android Chrome, and smoke-test both configured providers with fictional speech. See [Contributing](../CONTRIBUTING.md#browser-quality-checks) for browser commands.

Official Soniox references: [direct stream](https://docs.soniox.com/guides/direct-stream), [web SDK](https://docs.soniox.com/sdk/web-SDK/stt/realtime-transcription), [temporary keys](https://docs.soniox.com/authentication/temporary-api-keys), [key permissions](https://docs.soniox.com/authentication/api-key-permissions).
