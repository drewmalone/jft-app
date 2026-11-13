# Maintained decisions

## Speech provider support

Both Soniox and OpenAI live transcription are supported by product choice. Soniox is the default; a deployment explicitly chooses its provider. There is no automatic cross-provider fallback. Retain each provider's browser/server adapters and the shared `TranscriptionEngine` lifecycle contract, repository-independent tests and browser coverage. Provider differences belong inside their adapters. OpenAI text cleanup remains independently configured regardless of speech selection.

Revisit this decision when product requirements change; adding a provider entails credential restrictions, lifecycle/cancellation behavior, diagnostics and browser compatibility commitments.

## Speech availability and cleanup configuration

Speech is available by default without an opt-in feature flag. `STT_ENABLED` and `TRANSCRIPTION_ENABLED` are removed; obsolete deployment values no longer control speech or implicitly enable cleanup, and runtime preparation no longer emits them. Stale assignments in an existing artifact are inert; unrelated source and multiline values are preserved. Cleanup remains explicitly opt-in through `CLEANUP_ENABLED=true`.

Keep origin/session verification, provider credential requirements, per-owner quotas, `TRANSCRIPTION_DISABLED` and distributed emergency shutdown records. Always-available speech does not bypass those controls. Operators who previously used an enable flag to shut down speech must use the emergency control instead.

The missing-provider-header OpenAI compatibility path is a separate API decision and remains unchanged. Both current browser adapters send their selected provider. Removing that path requires a separate contract migration.
