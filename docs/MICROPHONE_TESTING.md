# Microphone permission handling and iPhone Safari verification

The editor requests `getUserMedia({ audio: true })` directly in the recording tap handler, before any asynchronous permission query. It immediately stops every returned track, then starts the existing Web Speech engine. No audio is retained or uploaded by this permission check. Browser-managed speech recognition may still use the browser vendor's service, as before.

The permission gate is separate from the replaceable engine. Its successful check is reused within the mounted editor, so subsequent starts can run synchronously in the tap handler. A hidden page, unmount, or recognition error invalidates that check. A later `getUserMedia` call uses the browser's saved permission; it cannot force a denied permission prompt to reopen. There is no dependency on `navigator.permissions`, whose microphone support varies between browsers.

Cancellation, hiding the page, and unmount invalidate pending startup. The browser does not provide an abort signal for `getUserMedia`; an unresolved native permission prompt may remain open. If it eventually grants access, the returned tracks are still stopped and canceled recognition cannot start.

## Safari activation investigation and limits

Awaiting a native permission prompt can outlive transient user activation. Calling both capture and recognition concurrently would preserve the original JavaScript task but could create competing capture sessions and permission dialogs. This implementation requests capture in the original task and serializes recognition after track cleanup. It does not add a mandatory second tap, run an automatic retry, or assume microphone permission grants speech-service authorization.

The current WebKit implementations of [SpeechRecognition::startRecognition](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechRecognition.cpp) and [SpeechRecognitionPermissionManager](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/SpeechRecognitionPermissionManager.cpp) do not impose a transient-activation check on recognition startup. They separately check microphone permission, speech-service authorization/availability, website permission, and page visibility. This supports sequencing the APIs, but source inspection is not validation of every shipped iOS/Safari release. No physical iPhone/native prompt validation was available in this environment. Run the following checks on the iOS versions you support before production rollout.

If a deployed Safari version rejects the first recognition start after a successful microphone grant, the app shows a speech-specific error and preserves the draft. Record the iOS version and safe debug codes; do not infer microphone denial. A subsequent user tap supplies fresh activation. There is no claim that the app can bypass OS restrictions or guarantee another permission dialog.

## Test locally from an iPhone with a Mac

Cloudflare Quick Tunnels provide a temporary HTTPS URL without an account. HTTPS is required for microphone access on the phone; opening the Mac's ordinary HTTP LAN address will not provide the same secure context.

On the Mac, in this repository:

```sh
git fetch origin
git switch fix/explicit-microphone-permission
git pull --ff-only
npm ci
npm run dev
```

In a second terminal:

```sh
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

Open the printed `https://….trycloudflare.com` URL directly in Safari on the physical iPhone. Both devices need internet access but do not need to share Wi-Fi; cellular can be used on the phone. Keep both terminal processes running and stop each with Control-C when finished. The tunnel URL is publicly reachable while running, so test with synthetic text.

`next.config.ts` allows `*.trycloudflare.com` through `allowedDevOrigins`, so changing Quick Tunnel hostnames can load development assets and connect to `/_next/hmr`. This option is only for the Next.js development server. Restart `npm run dev` after pulling this configuration change. To narrow the development allowlist, replace the wildcard with your current tunnel hostname, without `https://`, a port, or a path; restart whenever it changes.

### Disabled microphone or no permission prompt

The HMR cross-origin warning and a disabled microphone button are separate symptoms. When the app cannot detect `SpeechRecognition` or `webkitSpeechRecognition`, the recording button is disabled before a microphone permission request runs. Allowing development assets does not add browser speech support.

Confirm the correct branch is running and open the URL directly in Safari rather than an in-app browser. Check Siri settings under Settings → Siri or Apple Intelligence & Siri (the name varies by iOS version); Safari speech recognition can depend on device speech-service settings.

For capability diagnostics, enable Web Inspector under the iPhone's Settings → Apps → Safari → Advanced (older iOS versions use Settings → Safari → Advanced). Connect the iPhone to the Mac and trust it. Enable the Develop menu in Mac Safari's Advanced settings if needed, then use Develop → your iPhone → the tunnel page. Run this in the page's console:

```js
({
  secure: window.isSecureContext,
  microphoneAPI: !!navigator.mediaDevices?.getUserMedia,
  speechAPI: !!(window.SpeechRecognition || window.webkitSpeechRecognition)
});
```

All three should be true. If `secure` is false, verify that you opened the HTTPS tunnel URL. If `microphoneAPI` is false, microphone capture is unavailable in that browser/context. If `speechAPI` is false, the current browser/context cannot run the app's Web Speech engine and no microphone prompt will be attempted. These booleans indicate capability, not permission grants. Add `?speechDebug=1` to the URL to inspect the app's safe diagnostic events.

Use the permission and lifecycle checklist below against the tunnel URL as well as the Amplify deployment. Each new tunnel hostname has its own website permissions.

## Amplify manual test plan

Deploy the branch to an Amplify preview, or deploy through your normal release process. Open its actual HTTPS URL in Safari on a physical iPhone. Test each origin separately; preview and production domains have separate permissions. Use synthetic text for testing.

1. **Fresh permissions:** In Safari's page menu (the page controls or `aA`, depending on iOS), open Website Settings and set Microphone to Ask. If necessary, reset the website's permissions in iOS Safari settings. Reload. Loading the page must not prompt. Type a short draft, tap the microphone once, allow microphone access and any separate speech prompt, then speak. Verify recognition begins without a required second tap, interim text updates, final text appends, and stopping preserves it. Record the actual iOS version and outcome.
2. **Previously granted:** Set the site's Microphone permission to Allow. Reload and record. It should start without another microphone prompt. Stop and record several more times; verify no duplicate final text or overlapping sessions. Rapidly tap while starting and verify cancellation works and a late grant does not start a canceled session.
3. **Previously denied:** Set Microphone to Deny and reload. Tap to record; expect actionable microphone permission guidance, an unchanged draft, and no promise that another tap will reopen a prompt. Use Safari's Website Settings to set Microphone to Allow, return and try again. Also test denial from a fresh native prompt.
4. **Switch apps:** Test switching away while waiting for permission, while listening, and after stopping. Return to Safari and record again. Pending startup should cancel when the page becomes hidden; granting a late prompt must not start background recognition. Browser-ended sessions must allow another recording. No temporary permission stream should remain active after it settles; Safari's microphone indicator may remain active while Web Speech itself is listening.
5. **Permission granted, speech unavailable:** With microphone permission allowed, test a device where speech recognition is disabled/unavailable, or reproduce a service failure. A speech-service error must not claim microphone denial, and typed/finalized text must survive. Automated mocks separately cover `service-not-allowed` and `not-allowed`.
6. **Cancel/unmount:** Cancel while a permission prompt is pending, or navigate to Past shares before resolving it. Grant afterward. Recognition must not start. Return to the editor and confirm typing and recording still work.
7. **Diagnostics:** On the same HTTPS origin, add `?speechDebug=1` and use Safari's remote Web Inspector from a Mac if available. Expect microphone request/granted/denied/unavailable events and existing recognition start/error events. Logs must contain only event names, normalized codes, and safe metadata, never audio or transcript text. Use `?speechDebug=0` to disable the tab's logging.

Automated checks: `npm run typecheck`, `npm test`, and `npm run lint`. The mocked Playwright transcription tests can additionally run after `npm run build` with `npx playwright test tests/e2e/transcription.spec.ts`; they do not validate Safari's native prompts.
