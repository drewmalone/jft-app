# Live transcription deployment

The deployment selects OpenAI (default, direct WebRTC) or xAI (PCM over an authenticated external WebSocket relay) behind the unchanged `TranscriptionEngine`. The Next.js Node BFF issues temporary connection credentials and never transports live audio. OpenAI needs no additional service; xAI requires the standalone relay described below. The existing in-memory share repository still makes this a disposable prototype, including on Amplify.

## Configuration

| Variable                | Purpose                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `STT_ENABLED`           | Exact value `true` enables issuance; otherwise paid transcription fails closed.                  |
| `STT_OPENAI_API_KEY`    | Server-only direct key for local development/cloud workspaces. Never prefix with `NEXT_PUBLIC_`. |
| `STT_OPENAI_SECRET_ARN` | Alternative to the direct key: ARN of a plain-string Secrets Manager secret, read at runtime.    |
| `SESSION_SECRET`        | Existing production signing secret; at least 32 random bytes.                                    |

The direct key takes precedence when both key sources are configured. The secret ARN is nonsecret configuration. No key is read during build. A successful AWS secret read is cached for five minutes per process; redeploy/restart to pick up a rotation immediately. Empty/binary Secrets Manager values are rejected. Failed reads are retried by later requests.

For this cloud workspace, bind `STT_OPENAI_API_KEY` securely in environment settings and allow `api.openai.com`; a proxy-held binding is usable by the server SDK for that destination. Add `STT_ENABLED=true` to enable real recording. Do not copy workspace proxy placeholders into Amplify. Hosted browsers need their own network access to OpenAI WebRTC/HTTPS, independently of this workspace's network settings.

## AWS Amplify hosted preview

1. Create a dedicated OpenAI project/key with access to `gpt-live-transcribe` and the Realtime API. Keep it separate from production projects. Configure project monitoring/alerts and available rate restrictions; an alert/budget is not necessarily a hard spending cap.
2. Store the key as a **plain string** in AWS Secrets Manager. Do not put it into a committed file, a browser variable, or a build command. Configure an Amplify **SSR compute role** for the trusted preview branch with `secretsmanager:GetSecretValue` limited to that secret ARN. If using a customer-managed KMS key, grant `kms:Decrypt` for that key under the appropriate encryption-context conditions. Keep AWS credentials out of application configuration; the SDK uses the compute role.
3. Attach that compute role only to the branch that needs it, rather than granting arbitrary PR previews access to the key. The build service role and SSR compute role are different. The latter is required by runtime secret reads.
4. Supply the nonsecret `STT_OPENAI_SECRET_ARN` and `STT_ENABLED=true` to the **SSR runtime**. Amplify console build variables do not automatically become Next.js runtime variables. Extend the existing build configuration with a small Node command before `npm run build` that copies only those two validated nonsecret values to `.env.production`:

   ```js
   // Run with node during the trusted preview build, before npm run build.
   const fs = require('node:fs');
   const arn = process.env.STT_OPENAI_SECRET_ARN;
   if (
     !arn ||
     !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/.test(
       arn
     )
   ) {
     throw new Error('Configure the transcription secret ARN');
   }
   fs.appendFileSync(
     '.env.production',
     `\nSTT_OPENAI_SECRET_ARN=${arn}\nSTT_ENABLED=true\n`
   );
   ```

   Do not copy the permanent API key into build artifacts or dump environment variables. Preserve the deployment's existing handling of `SESSION_SECRET`. Leave transcription disabled on untrusted branches; enabling a build setting alone does not create secret permissions.

5. Enable Amplify branch access/password protection for this hosted preview **before enabling paid sessions**. An anonymous signed cookie is not user authentication. The endpoint's exact-origin check blocks foreign browser origins, and its five-attempts/minute per-session guard reduces accidental bursts within one process; neither prevents determined callers, new cookies, or abuse across serverless instances. Ephemeral credentials can establish multiple sessions and their session configuration can be changed by a modified client. A public launch requires a separate authenticated, distributed entitlement/quota design. Do not treat client ten-minute limits as hard provider spending limits.
6. Deploy, open the trusted HTTPS preview, establish the normal app session, and record fictional text. Confirm token issuance returns 200 without exposing the permanent key; check the OpenAI project usage dashboard. Verify stop, trailing words, interruptions and physical phones using the README checklist. Do not log credential response bodies, audio, provider event payloads, transcripts, or sensitive upstream errors in CloudWatch/APM/browser tooling.

This change supplies the runtime code and instructions; it does not create AWS resources, attach IAM roles, change Amplify settings, or validate a hosted deployment. It also does not fix existing process-local share persistence across Amplify instances.

Official references: [Amplify SSR compute roles](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-SSR-compute-role.html), [SSR environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html), [OpenAI client secrets](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create), [live transcription](https://developers.openai.com/api/docs/guides/realtime-transcription), [pricing](https://developers.openai.com/api/docs/pricing), [data controls](https://developers.openai.com/api/docs/guides/your-data).

## Diagnosing a credential endpoint 503

For local development, put `STT_OPENAI_API_KEY` and `STT_ENABLED=true` in `.env.local` beside `package.json`, then restart `npm run dev`. The key's **Realtime → Request** permission covers the `/v1/realtime/client_secrets` operation used here; unrelated Responses, text-to-speech, and List models permissions are not needed by this operation. Project billing and access to the configured transcription model must also be available.

A browser-side 503 is intentionally generic. Read the **server terminal** (or server logs on Amplify) for `[Doorknob transcription]`:

- `disabled`: `STT_ENABLED` was not exactly `true` in the server process.
- `missing_key`: neither a direct key nor a Secrets Manager ARN was configured.
- `invalid_secret_arn` / `secret_unavailable`: check the configured ARN and SSR compute role.
- `provider_request_failed`: the accompanying HTTP status and allowlisted code distinguish key rejection (401), permission denial (403), unavailable model (often 404/`model_not_found`), quota/rate limits (429), or request validation (400). The safe parameter name can identify a configuration field without revealing its value.
- `server_or_connection_failure`: check server connectivity and session-signing configuration.

Diagnostics never include raw provider messages, exceptions, request bodies, response bodies, tokens, key values, or transcripts. Unknown provider codes/parameters are printed as `unknown`. You can share the diagnostic category/status/code without sharing your key. Do not enable verbose SDK HTTP logging or paste `.env.local` contents.

### Credential succeeds but no words appear

Open the app with `?speechDebug=1`, enable **Info** messages in the browser developer console, and filter for `[Doorknob speech]`. This is browser-side logging; the server terminal cannot observe the direct WebRTC audio stream. Record fictional words for about five seconds, pause, then Stop. Share the filtered diagnostic lines, not raw Network responses or provider frames.

- `credential-response` should report 200.
- `webrtc-answer-response` should report a successful HTTP status, followed by `webrtc-answer-applied` and `data-channel-open`.
- `provider-session` should identify transcription mode and the expected model. Unknown mode/model is recorded only as `other`.
- `webrtc-audio-sent` reports outbound audio packet/byte totals every two seconds while diagnostics are enabled. Increasing totals establish that audio packets leave the browser, not that the provider recognizes speech. No audio, candidate addresses or track IDs are logged.
- `microphone-activity` reports local sound detection. `provider-event` reports allowlisted event types and character counts, never the words themselves. Delta/completed events with positive counts show transcription is arriving.
- `audio-turn-commit` reports a silence/stop commit. `provider-error` reports only allowlisted codes. A failed handshake, non-increasing audio totals, no provider transcript events, and missing finalization are distinct observations; do not infer the cause from the absence of the old server error alone.

Visit `?speechDebug=0` afterward to disable diagnostics. Outbound packet sampling stops when the session is disposed and does not run when diagnostics are disabled.

## Automatic draft cleanup after Stop

The OpenAI server-only key independently calls `/v1/responses` for `gpt-5.4-mini` paragraph/filler cleanup after successful explicit Stop. An unrestricted key covers endpoint permissions; restricted keys need Responses Request as well as Realtime Request. Cleanup itself requires no additional service. Keep the OpenAI key/secret configured even when speech uses xAI; a missing cleanup key preserves the draft with the existing retry behavior. `STT_ENABLED=true` enables both operations. Cleanup has its own bounded process-local burst guard and uses `store:false`, structured output, reasoning off, and no tools. A model-access/provider failure leaves the original editable and saveable. Safe failures appear as `[Doorknob cleanup]` with the same redaction policy.

The full unsaved finalized draft is sent through the BFF before explicit saving, including typed text already in that draft. Review remains important because AI may alter meaning despite instructions. See README for expected additional text-model cost and review behavior. Test with fictional spoken filler text, multiple topics, intentional repetition and negations; verify names/numbers and meaning against the original, exercise editing and failure, then save and inspect paragraph layout in owner and recipient views. Automated tests mock all provider calls and do not validate live editing quality.

## Waiting for microphone versus connecting

Waiting for microphone access now describes the native permission/device phase only. Connecting transcription means the microphone is granted but the remote transport is not ready. Cancel connection stops capture and cancels startup. Credential fetching overlaps the permission wait, and SDP/local ICE preparation overlaps credential loading. Both requests begin only after the recording tap. There is no prefetch on page load, raw audio buffering, credential cache, or early Listening indicator.

With `?speechDebug=1`, compare `microphone-permission-granted.elapsedMs` and `data-channel-open.elapsedMs` (since the tap) against `credential-response.elapsedMs`, `webrtc-offer-created.elapsedMs` and `webrtc-answer-response.elapsedMs` (duration of their own phases). This separates slow native permission/device startup, BFF/provider credential latency, remote SDP/model setup and ICE/data-channel establishment. No fixed real-world speedup is claimed by mocked concurrency tests.

Cleanup failures now distinguish `cleanup_not_completed` (with `max_output_tokens`/`content_filter` when supplied), `cleanup_refused`, `missing_cleanup_output`, and `invalid_cleanup_output`. Provider connection/timeouts have separate safe categories. Original draft preservation and retry behavior are unchanged; raw response text and parser errors are never logged.

## Provider selection and xAI relay

`STT_PROVIDER` accepts exactly `openai` or `xai`; absence means `openai`. Empty, misspelled or whitespace-padded values fail with an authored startup error. `src/instrumentation.ts` validates selection on Node server startup. `server/transcription-config.ts` fixes it for the process lifetime. The home page uses `connection()` to serialize this nonsecret value at request time, rather than baking it into a static page or `NEXT_PUBLIC_` variable. Restart/redeploy to change providers. New recording requests include `X-STT-Provider`; stale pages from a different deployment fail with 503 and must reload. Requests never select a different provider, and there is no fallback.

| Variable                                       | Runs on       | Purpose                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STT_PROVIDER`                                 | App           | `openai` (default) or `xai`.                                                                                                                                                                                     |
| `STT_ENABLED`                                  | App           | Existing exact `true` gate for paid speech and cleanup.                                                                                                                                                          |
| `STT_OPENAI_API_KEY` / `STT_OPENAI_SECRET_ARN` | App           | Existing OpenAI credential sources; still required for cleanup with xAI.                                                                                                                                         |
| `STT_XAI_RELAY_URL`                            | App and relay | Exact public `wss://relay.example/stt`, without credentials, query or fragment. Local development permits loopback `ws://localhost:8080/stt`.                                                                    |
| `STT_XAI_RELAY_SECRET`                         | App and relay | Matching random signing key of at least 32 bytes. A separate secret from the provider key and `SESSION_SECRET`. Direct source takes precedence.                                                                  |
| `STT_XAI_RELAY_SECRET_ARN`                     | App only      | Alternative plain-string Secrets Manager source for that signing key. Runtime reads use the SSR compute role, five-minute successful-read cache and bounded AWS timeout; failures can recover on later requests. |
| `STT_XAI_API_KEY`                              | Relay only    | Permanent xAI API key. Never supplied to the browser or required by Amplify. No `STT_XAI_SECRET_ARN` resolver is implemented; inject this environment value from ECS Secrets Manager integration.                |
| `STT_XAI_ALLOWED_ORIGINS`                      | Relay only    | Comma-separated exact app origins, e.g. `https://preview.example`; no paths, trailing slash or wildcard.                                                                                                         |
| `PORT`                                         | Relay only    | HTTP/WebSocket listener, default `8080`; TLS terminates at the load balancer.                                                                                                                                    |
| `SESSION_SECRET`                               | App           | Existing production cookie signing key, at least 32 bytes.                                                                                                                                                       |

OpenAI local `.env.local` example (values below are placeholders):

```dotenv
STT_ENABLED=true
STT_PROVIDER=openai
STT_OPENAI_API_KEY=<OpenAI key>
```

xAI local `.env.local` example:

```dotenv
STT_ENABLED=true
STT_PROVIDER=xai
STT_OPENAI_API_KEY=<OpenAI cleanup key>
STT_XAI_RELAY_URL=ws://localhost:8080/stt
STT_XAI_RELAY_SECRET=<random shared signing key of at least 32 bytes>
```

Run the relay separately using Node 24:

```bash
cd services/xai-relay
npm ci
# Securely inject these into this process; do not commit an env file:
# STT_XAI_API_KEY, STT_XAI_RELAY_SECRET, STT_XAI_RELAY_URL
# STT_XAI_ALLOWED_ORIGINS=http://localhost:3000
npm start
```

The standalone service does not load Next's `.env.local`. Configure its environment separately, then run the app with `npm run dev` from the repository root. Use an HTTPS app and WSS relay reachable by the device for physical iPhone tests; a phone's localhost is not the developer machine. Automated tests use synthetic credentials, mock sockets and synthetic PCM; they never call a paid provider. `npm run check` and `npm run typecheck` cover the app and relay core. The relay's pinned `ws` dependency has its own lockfile and is installed separately.

### Why a separate service

The reviewed [xAI STT guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text) and [streaming reference](https://docs.x.ai/developers/rest-api-reference/inference/speech-to-text) require bearer-authenticated streaming and recommend a backend proxy. The [ephemeral token guide](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens) documents speech-to-speech Realtime tokens, without confirming their use for `/v1/stt`. This implementation therefore does not assume they authorize STT. It uses `grok-voice-transcribe-2.0`, interim results, mono PCM16 at 48 kHz, and the documented STT WebSocket. No batch transcription is substituted.

The relay in `services/xai-relay/` is a long-running Node HTTP/WebSocket service. Amplify SSR handles only the short ticket-issuance request. Do not route `/stt` through a Next Route Handler, Amplify rewrite or Lambda response stream. The repository includes relay source and a container definition, not provisioned AWS infrastructure.

### AWS prerequisites for xAI

1. Provision an ECS/Fargate service (one Node process/task) behind an HTTPS Application Load Balancer with a valid certificate and a dedicated relay DNS name. Allow WebSocket upgrades on `/stt`, health checks on `/health`, and outbound TLS to `api.x.ai`. Keep tasks private, with their listener reachable only from the load balancer. Set load-balancer idle timeout to at least 75 seconds. The service actively forwards streaming frames, but unexpected disconnects still fail safely.
2. Use **one replica** for this implementation. Ticket replay protection is process-local. Multiple replicas require an atomic shared nonce store before scaling; load-balancer stickiness alone is insufficient. One process accepts at most 32 connections, allows five seconds for initial authentication and bounds startup, audio rate, message sizes, queued bytes, recording lifetime and finalization. These are operational safeguards, not a distributed user quota.
3. Inject `STT_XAI_API_KEY` and `STT_XAI_RELAY_SECRET` using ECS secret bindings. Give the task execution role only the required Secrets Manager/KMS access. Configure `STT_XAI_RELAY_URL` and exact `STT_XAI_ALLOWED_ORIGINS`; set `NODE_ENV=production`. Keep trusted-preview protection and the existing anonymous-session limitations in mind. A valid anonymous cookie is not a user entitlement.
4. On Amplify, supply `STT_PROVIDER=xai`, `STT_ENABLED=true`, `STT_XAI_RELAY_URL`, `STT_XAI_RELAY_SECRET_ARN` and the existing `STT_OPENAI_SECRET_ARN` to the **SSR runtime**. Adapt the earlier build snippet to persist only these validated nonsecret values into `.env.production`; validate provider against the two literals, relay URL against the rules above, and both ARNs against the existing ARN pattern. Do not copy either API key or the signing secret into build artifacts. The SSR compute role needs `GetSecretValue` and, where applicable, `kms:Decrypt` for the signing-key secret and OpenAI cleanup secret. The xAI API key belongs only to the relay.
5. Configure browser/connect CSP policies, if supplied externally, to allow the relay WSS origin and the same-origin AudioWorklet module. Disable request-body/frame logging in proxies, APM and load-balancer middleware. Authentication tickets are sent in the first frame rather than a URL or subprotocol, so ordinary URL access logs cannot contain them.
6. Deploy only with explicit operator approval. Coordinate signing-key rotations with the app's five-minute cache and relay restart; temporarily rejected sessions require a fresh Record attempt. This change creates or modifies no AWS resources.

The app can build without provider keys. xAI startup requires its relay URL and signing-key configuration; relay startup requires its permanent xAI key. An absent OpenAI cleanup key under xAI leaves the original finalized draft intact with the normal cleanup failure/retry behavior.

### Relay and transcript lifecycle

The BFF checks the existing cookie, exact Origin, enablement and burst guard before signing a 60-second HMAC ticket bound to the relay URL and browser origin. The relay checks the origin allowlist and ticket signature/expiry, consumes its nonce once, then opens the fixed xAI endpoint with a server-only Authorization header. Clients cannot change upstream model, destination or credentials. Neither service stores audio or transcripts; both network legs still process them in memory.

The adapter creates/resumes an AudioContext in the recording gesture, acquires the microphone once, and attaches an AudioWorklet only after `transcript.created`. It downmixes to mono PCM16, sending 100 ms frames; it does not use Safari's MediaRecorder containers as raw PCM. Listening starts only when capture is ready. Local activity comes from transcript results; this remains a speech cue rather than a sound meter.

Chunk-final text stays in the live provisional display until the provider supplies the stitched utterance. An utterance-final result is committed once and does not end recording. Duplicate/stale fragments are ignored, pending chunks are ordered by audio timestamp, and conflicting overlaps fail safely with finalized words retained. The WebSocket transport preserves wire order; arbitrary reordering of already committed utterances is not reconstructed. Stop immediately releases microphone tracks, flushes the worklet's short trailing frame, sends `audio.done`, and waits for the cumulative `transcript.done`, reconciling trailing words by timestamps or an exact transcript prefix. Unsupported ambiguous summaries fail visibly rather than appending duplicate text. There is a five-second finalization deadline. Disposal cancels startup, closes audio nodes/ports/context/socket and silences stale callbacks.

### Manual comparison and limitations

On physical iPhone Safari, run the README device checklist once per deployment configuration using the same fictional speech. Include a permission prompt, continuous speech longer than three seconds, a pause, a repeated phrase, a final word immediately before Stop, Stop during silence and connection startup, resume, and background/network interruption. Verify the OS microphone indicator stops promptly, no final words repeat, the teleprompter updates, cleanup still appears, edits survive failures, and only explicit Save creates history/sharing. Compare time to first provisional words and finalization time without recording sensitive payloads.

Physical iOS capture, provider quality, account model availability, hosted latency and AWS deployment have not been validated by deterministic tests. Modern Safari AudioWorklet and a 48 kHz AudioContext are required; unsupported capture fails safely. PCM costs about 96 kB/s per audio leg before overhead, so relay bandwidth/hosting adds cost. xAI retention/account terms and usage charges must be checked independently; OpenAI cleanup still transmits the finalized text to OpenAI. There is no automatic fallback or reconnect/replay, audio storage, shared relay nonce store, public-user entitlement system, or durable share storage in this change.
