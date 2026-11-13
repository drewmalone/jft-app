# Maintained decisions

## Speech provider support

Both Soniox and OpenAI live transcription are supported by product choice. Soniox is the default; a deployment explicitly chooses its provider. There is no automatic cross-provider fallback. Retain each provider's browser/server adapters and the shared `TranscriptionEngine` lifecycle contract, repository-independent tests and browser coverage. Provider differences belong inside their adapters. OpenAI text cleanup remains independently configured regardless of speech selection.

Revisit this decision when product requirements change; adding a provider entails credential restrictions, lifecycle/cancellation behavior, diagnostics and browser compatibility commitments.

## Feature flag compatibility retirement

`TRANSCRIPTION_ENABLED` and `CLEANUP_ENABLED` are canonical. `STT_ENABLED` is deprecated compatibility for pre-0.4 configuration, with removal scheduled for 0.4. This refactor preserves the existing fallback and strict validation; it does not silently change existing deployments.

Before removal, operators must run runtime preparation for every hosted branch, verify both canonical flags are explicitly delivered, remove `STT_ENABLED` from the deployment source, redeploy and verify independent feature behavior. The preparation script already emits both canonical flags. Keep a dedicated fallback regression until removal; new application scenarios use canonical flags. If migration is incomplete, move the removal release explicitly rather than silently dropping support.

The missing-provider-header OpenAI compatibility path is a separate API decision and remains unchanged. Both current browser adapters send their selected provider. Removing that path requires a separate contract migration.
