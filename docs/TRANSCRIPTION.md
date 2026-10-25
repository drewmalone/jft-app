# Live transcription deployment

The browser implements OpenAI transcription behind `TranscriptionEngine`, with direct WebRTC audio transport. The Next.js Node BFF only issues short-lived credentials using the official OpenAI SDK. No WebSocket proxy, persistent Amplify connection, audio upload/storage, or separate audio service is required. The existing in-memory share repository still makes this a disposable prototype, including on Amplify.

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
