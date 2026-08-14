---
name: run-cloud-ios-simulator
description: Operate run.cloud iOS simulator and Android emulator sessions with the CLI or TypeScript SDK. Use for creating, installing, inspecting, reading logs, controlling, embedding, smoke-testing, connecting local Metro, taking screenshots, injecting iOS media, or releasing remote mobile sessions.
---

# Operate run.cloud Mobile Sessions

Use the `runcloud` CLI for terminal workflows, `@run-cloud/sdk` for TypeScript,
and `@runcloud/ui` for React embeds.

## Authenticate

- Install the CLI with `npm install -g runcloud`.
- Use `runcloud login`; add `--manual` when a local callback cannot open.
- In CI, set `RUN_CLOUD_API_KEY`. `RUN_CLOUD_API_TOKEN` is an equivalent alias.
- Set `RUN_CLOUD_API_URL` only to override `https://api.run.cloud`.
- Require Node.js 20 or newer.
- Never print, commit, or place credentials in a skill file. Treat signed session
  and tunnel URLs as bearer secrets.

Check access and credit before starting metered work:

```bash
runcloud account --json
```

The SDK equivalents are `cloud.account()` and `cloud.usage({ orgId? })`.

## Create and Release Sessions

```bash
SESSION_ID=$(runcloud ios create \
  --install ./build/MyApp.tar.gz \
  --inactivity-timeout 60s \
  --hard-timeout 10m \
  --json | jq -r '.id')

trap 'runcloud ios delete "$SESSION_ID" >/dev/null 2>&1 || true' EXIT
runcloud ios get "$SESSION_ID" --json
```

Replace `ios` with `android` for an Android artifact. The shared lifecycle is
`create`, `list`, `get`, `open-url`, `logs`, and `delete`. Use `--json` whenever
another program consumes output, and inspect `runcloud ios|android --help` for
create and log options.

iOS needs an Apple Silicon simulator-compatible `.app`, `.zip`, `.tar.gz`, or
`.ipa`; a device-signed App Store IPA is not a substitute. Android needs an
emulator-compatible APK.

## Control a Session

Both platform groups expose acknowledged controls:

```bash
runcloud ios tap "$SESSION_ID" 0.5 0.3 --json
runcloud ios swipe "$SESSION_ID" 0.5 0.8 0.5 0.2 --duration 300 --json
runcloud ios type-text "$SESSION_ID" 'hello' --json
runcloud ios press-key "$SESSION_ID" enter --json
runcloud ios press-button "$SESSION_ID" home --json
runcloud ios screenshot "$SESSION_ID" --output ios.png --json
```

The full control set is `tap`, `swipe`, `gesture`, `type-text`, `press-key`,
`press-button`, `rotate`, `reload`, `scroll`, `toggle-software-keyboard`,
`simulate-memory-warning`, `rotate-digital-crown`, `set-render-debug`, and
`screenshot`. Every interaction accepts `--request-id`, `--timeout`, and
`--json`; use `runcloud <platform> <control> --help` for its typed arguments.

Coordinates use the current display orientation: `(0, 0)` is top-left and
`(1, 1)` is bottom-right. Gesture steps use one or two points with `begin`,
`move`, and `end` phases. Each `delayMs` is the pause before the next step, so
the final `end` step must use `0`. Key names are semantic US-keyboard names;
modifiers are `shift`, `control`, `alt`, and `meta`. Current mobile sessions do
not support Digital Crown input, and Android does not support iOS render-debug
controls or the `capsLock`, `numLock`, and `scrollLock` keys. Handle structured
`unsupported_action` errors instead of retrying them.

An acknowledgement means input dispatch completed. Confirm visible app effects
with a screenshot or the signed viewer when the outcome matters.

## Inject Deterministic Media

Both platforms accept prerecorded camera and microphone input:

```bash
runcloud ios camera inject "$SESSION_ID" ./pattern.mp4 --bundle-id com.example.Camera --json
runcloud android microphone inject "$SESSION_ID" ./tone.wav --bundle-id com.example.Recorder --json
```

`microphone` has the `mic` alias. Arm the native camera or microphone receiver
before injecting, then verify app-owned frame or sample state; the service
acknowledgement alone does not prove capture. Delete the returned media asset
with `runcloud asset delete <asset-id>` after the proof.

## Use the TypeScript SDK

```bash
npm install @run-cloud/sdk
```

Always release metered sessions in `finally`:

```ts
import { writeFile } from "node:fs/promises";
import { Client } from "@run-cloud/sdk";

const cloud = new Client();
const session = await cloud.android.create({
  inactivityTimeout: "60s",
  hardTimeout: "10m",
  tags: { owner: "agent" },
});

try {
  await cloud.android.tap(session.id, { x: 0.5, y: 0.3 });
  await cloud.android.typeText(session.id, "hello");
  await cloud.android.pressKey(session.id, "enter");
  const screenshot = await cloud.android.screenshot(session.id);
  await writeFile("android.png", screenshot);
} finally {
  await cloud.android.delete(session.id);
}
```

`cloud.ios`, `cloud.android`, and the platform-selectable `cloud.simulators`
expose `interact` plus convenience methods matching every CLI control above.
Interaction options accept `requestId`, `timeoutMs`, and `signal`; results are
typed acknowledgements. Use `RunCloudError` fields such as `code`, `retryable`,
`requestId`, and `action` when reporting API failures.

The lifecycle surface also includes `create`, `list`, `get`, `openUrl`, `logs`,
`followLogs`, and `delete`. Both platforms expose `screenshot`,
`uploadCameraVideo`, and `uploadMicrophoneAudio`; iOS additionally supports
`uploadVideo` for Photos imports. Inspect the installed types for complete
create, asset, log, and media options.

In compact form, `cloud.ios`: `create`, `list`, `get`, `openUrl`, `logs`, `followLogs`, `screenshot`.
`cloud.android` provides the same shared lifecycle, media, and control operations.

## Diagnose App Failures

```bash
runcloud ios logs "$SESSION_ID" --tail 1000
runcloud android logs "$SESSION_ID" --tail 1000
```

Use `--follow` while reproducing an issue. Before releasing a failed session,
capture a bounded retained snapshot; a follow stream contains only new entries.

## Connect Local Development

Connect a local Metro or mock server through the supported sidecar flow:

```bash
runcloud ios tunnel "$SESSION_ID" --local-port 8081 --service metro --json
runcloud ios tunnel-status --json
```

Do not expose an unauthenticated third-party tunnel. If the sidecar is
unavailable, report that requirement instead of guessing a public URL.

## Embed a Session

- Use `RemoteControl` from `@runcloud/ui` with the signed session URL.
- Its ref exposes promise-based `interact` and convenience methods matching the
  SDK controls. Handle `onInteractionResult` for inspectable acknowledgements.
- Add `embed=1` to raw iframe URLs. Add `loadingGuard=1` when interaction should
  wait for streaming and app readiness.
- Raw iframe requests use `run-cloud:interaction`; acknowledgements use
  `run-cloud:interaction-result`. Correlate them by `requestId`. To stop a
  pending request, post `run-cloud:interaction-cancel` with the same
  `requestId` and `action`.
- Verify `event.source` and the exact signed-URL origin, and use that origin as
  the `postMessage` target.
- Legacy `ios-simulator:command` messages remain compatibility-only. Prefer the
  generic acknowledged interaction channel for new code.
- Create a new session after an `ios-simulator:session-restart-requested`
  message; never reuse an ended URL.

## Assets, Samples, and Demos

```bash
runcloud sample download ios
runcloud asset push ./build/MyApp.tar.gz --name my-app --json
runcloud asset pull <asset-id>
runcloud ios create --install-asset my-app --json
runcloud demo run eight-device-mosaic --open
runcloud demo run live-camera-relay --open
```

Delete uploaded assets when no longer needed. Bundled demos release their
sessions automatically.

## Guardrails

- Release every session created during a task unless asked to keep it open.
- Use inactivity and hard timeouts for unattended work.
- Verify artifact/platform compatibility before changing app code after an
  install failure.
- Do not expose credentials, signed viewer URLs, tunnel URLs, or simulator
  tokens in logs, screenshots, PR comments, or chat output.
