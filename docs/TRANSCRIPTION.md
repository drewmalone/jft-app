# Live transcription deployment

Soniox is the default speech provider. `STT_PROVIDER=openai` selects the existing direct WebRTC adapter. No automatic fallback is performed. The provider is fixed at server startup, and its non-secret name is serialized through the runtime page bootstrap so the browser can select the appropriate WebSocket/WebRTC SDK for direct streaming, and checked by `/api/transcription/session` against `X-STT-Provider`. Missing headers retain legacy OpenAI semantics; stale clients receive a safe 503 and should reload. Empty, misspelled or whitespace-padded configuration fails startup. `xai` remains reserved and fails until the separate xAI integration is installed.

## Runtime configuration

| Variable                                       | Purpose                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `STT_ENABLED`                                  | Exact `true` enables paid transcription and existing text cleanup.                                                      |
| `STT_PROVIDER`                                 | `soniox` (default when absent) or `openai`. Restart/redeploy to change.                                                 |
| `STT_SONIOX_API_KEY`                           | Local development only; ignored in production. Never a public variable.                                                 |
| `STT_SONIOX_SECRET_ARN`                        | Deployed permanent Soniox plain-string secret, read through the SSR compute role.                                       |
| `STT_OPENAI_API_KEY` / `STT_OPENAI_SECRET_ARN` | Independent existing OpenAI credentials, still required for `gpt-5.4-mini` cleanup, and speech when OpenAI is selected. |
| `SESSION_SECRET`                               | Existing stable production signing secret, at least 32 random bytes.                                                    |

Local `.env.local`: set `STT_ENABLED=true`, `STT_PROVIDER=soniox`, and the direct Soniox key securely. Add the OpenAI development key for cleanup. Never commit this file. No AWS credentials are needed for this local mode. Soniox direct development keys take precedence outside production. Secrets Manager reads cache successful keys for five minutes per process; failed reads are retried later. Restart to pick up rotation immediately. Empty/binary secret values fail closed. The AWS SDK uses its normal credential chain and the attached compute role; no static AWS keys are added.

## Provider protocol and lifecycle

Only an explicit Record tap invokes the official `@soniox/client` recording API. It acquires the microphone immediately (preserving mobile Safari user activation), buffers startup audio in memory, resolves a temporary key through the existing same-origin endpoint, and streams directly to Soniox over WebSocket. Audio is never proxied through Amplify or persisted by this application. No batch upload, translation or browser speech-recognition fallback is added.

The server validates the signed anonymous session, exact browser origin, enable flag and existing process-local burst limit before contacting `POST https://api.soniox.com/v1/auth/temporary-api-key`. Its body fixes `usage_type: transcribe_websocket`, `single_use: true`, `expires_in_seconds: 60`, and `max_session_duration_seconds: 600`. Soniox returns `api_key` and an ISO `expires_at`; the server returns only `{ value, expires_at }`, with Unix seconds matching the existing credential contract. The permanent key never crosses the browser boundary. Requests have bounded timeouts and cancellation. Expiry limits connection establishment; the separate duration constraint bounds the active stream. The browser selects `stt-rt-v6`; the temporary-key policy does not pin the model.

Each response contains new final tokens and a replacement non-final suffix. The protocol preserves provider order and concatenates token text verbatim. It uses the platform’s `Intl.Segmenter` word boundaries and retains the last lexical unit until another safe whitespace boundary to join split subwords and punctuation correctly before the editor inserts segment spacing. Pending finalized text plus provisional text appears live. Endpoint/finish/error flushes remaining finalized text; provisional guesses are discarded. Timed retransmissions are ignored using timestamp/text identity, while legitimate repetitions at different timestamps remain. Untimed finals follow Soniox's incremental-delivery contract. No automatic reconnect is enabled with single-use credentials.

SDK `stop()` immediately releases capture and permits trailing finals. Stop during connection cancels the session. SDK `cancel()` handles disposal, late permission completion and immediate resource release. Startup (20 seconds), finalization (5 seconds), and recording (10 minutes) limits remain; page hiding, external microphone muting and page exit interrupt the session. All callbacks are guarded after disposal. Each new recording uses a fresh engine/credential. Existing typed/final text remains editable after failures.

## Cleanup stays independent

`server/cleanup-provider.ts` remains OpenAI, using `gpt-5.4-mini`, structured output, reasoning off, `store:false`, no tools and existing deadlines. Successful explicit Stop sends the finalized draft (including typed text) through the BFF for cleanup. Failure preserves the original. A Soniox key cannot authorize this operation; retain OpenAI secret permissions even when switching speech providers. No translation, summarization or feedback is added.

## Amplify and Terraform

See [the infrastructure runbook](../infra/terraform/README.md#soniox-live-transcription) for account/key setup, secret metadata and IAM resources, separate dev/prod configuration, plan/apply commands, branch role association, rollback and cost controls. Run `node scripts/prepare-transcription-env.mjs` before `npm run build` in the existing trusted Amplify build. It copies only allowlisted non-secret `STT_ENABLED`, `STT_PROVIDER` and the two secret ARNs to `.env.production`. Never copy API key values or print environment variables. Preserve existing session-secret delivery. Deploy only to trusted branches with the intended SSR role; do not attach secret-capable roles to arbitrary previews.

## Security, retention and diagnosis

Anonymous signed cookies establish ownership, not authenticated spending entitlement. Exact-origin validation and per-process five-attempts/minute burst limits do not prevent scripted abuse, new cookies, distributed instances or concurrency. Single-use keys and server-enforced duration reduce reuse but do not impose a global spending cap. Protect previews before enabling paid sessions. Before public launch implement distributed quotas/concurrency limits, abuse controls and provider-level spending controls; monitor Soniox audio usage and OpenAI cleanup usage separately. Alerts are not guaranteed hard caps.

Doorknob stores no audio. Soniox receives live audio, and OpenAI receives the finalized draft for cleanup. Confirm the providers' current retention, region, contractual privacy terms and account controls before sending recovery reflections; application storage policies do not govern provider retention. Do not promise zero provider retention. No provider payload, credential, transcript, audio or sensitive upstream error should enter logs/APM. Soniox SDK logging is not enabled; its errors become fixed app-authored notices. Server diagnostics use safe categories only. A generic 503 can mean disabled issuance, missing/invalid secret configuration, provider permission/quota/availability, or a stale provider bootstrap. Check configuration, compute-role access and provider console usage without inspecting or sharing credential response bodies.

OpenAI's optional `?speechDebug=1` diagnostics remain available for its WebRTC adapter: credential/SDP status, transport lifecycle, allowlisted event names and packet counts contain no speech. These WebRTC-specific markers do not describe the Soniox WebSocket adapter. Turn diagnostics off with `?speechDebug=0`.

## Validation and release checks

Automated tests mock paid providers. They cover token replacement, split words/punctuation, timed deduplication, real repeated words, trailing results, early Stop, cancellation, stale callbacks, credential policy, secret lookup, safe errors and unchanged OpenAI/cleanup/editor/save/share contracts. Browser tests use synthetic microphone and provider boundaries, exercising the real SDK and application without credits. These do not establish actual provider behavior or physical-device permission handling.

Before rollout, use fictional text with real Soniox on iPhone Safari and Android Chrome: allow/deny permissions, interrupt audio with calls/backgrounding, cancel while connecting, speak split/hesitant/repeated words, pause then Stop, verify trailing punctuation, edit, record again, inspect cleanup failure/success, save and read a public link. Check actual microphone indicator shutdown, latency, recognition quality, session cap enforcement, account usage, and no secrets in bundles/logs. Also smoke-test `STT_PROVIDER=openai`. No live provider or AWS deployment is implied by local validation.

Official references (reviewed for this implementation): [direct stream](https://docs.soniox.com/guides/direct-stream), [Web recording SDK](https://docs.soniox.com/sdk/web-SDK/stt/realtime-transcription), [SDK reference](https://docs.soniox.com/sdk/web-SDK/reference), [temporary keys](https://docs.soniox.com/authentication/temporary-api-keys), [key permissions](https://docs.soniox.com/authentication/api-key-permissions), [temporary-key API](https://docs.soniox.com/api-reference/auth/create_temporary_api_key).

Shared lifecycle timeouts and maximum recording duration live in `transcription/session-config.ts`, independently of either provider. CI quality checks/builds exercise the default Soniox configuration; only OpenAI-specific browser contracts explicitly select OpenAI.
