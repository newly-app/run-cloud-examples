---
name: run-cloud-ios-simulator
description: Operate run.cloud iOS simulator and Android emulator sessions with the CLI or TypeScript SDK. Use for creating, installing, inspecting, embedding, smoke-testing, connecting local Metro, capturing iOS screenshots, injecting iOS media, or releasing remote mobile sessions.
---

# Operate run.cloud Mobile Sessions

Use run.cloud through the `runcloud` CLI for terminal workflows and
`@run-cloud/sdk` for application, CI, or agent code.

## Authenticate

- Install the CLI with `npm install -g runcloud`.
- Use `runcloud login` for an interactive browser handoff. Use
  `runcloud login --manual` when a local callback cannot open.
- In CI, set `RUN_CLOUD_API_KEY`. `RUN_CLOUD_API_TOKEN` is an equivalent alias.
- Set `RUN_CLOUD_API_URL` only to override the production default
  `https://api.run.cloud`.
- Never print, commit, or place credentials in a skill file.
- Treat signed simulator URLs and tunnel URLs as bearer secrets.
- Require Node.js 20 or newer for the CLI and TypeScript SDK.

Inspect account and organization credit before starting metered work:

```bash
runcloud account --json
```

Sessions require product access, organization credit below its ceiling, and
available fleet capacity. A create request may queue while capacity is full.

## Choose the Interface

- Prefer CLI commands with `--json` for shell automation.
- Prefer `@run-cloud/sdk` for TypeScript applications and CI.
- Inspect `runcloud <command> --help` or installed SDK types before using a
  method not documented here.

## Use the CLI

Create an iOS session, capture its ID, open a deep link, and release it:

```bash
SESSION_ID=$(runcloud ios create \
  --install ./build/MyApp.tar.gz \
  --inactivity-timeout 60s \
  --hard-timeout 10m \
  --json | jq -r '.id')

trap 'runcloud ios delete "$SESSION_ID" >/dev/null 2>&1 || true' EXIT

runcloud ios get "$SESSION_ID" --json
runcloud ios open-url myapp://settings --id "$SESSION_ID" --json
```

Use the corresponding `runcloud android` commands for Android artifacts.

The shared mobile lifecycle is:

- `runcloud ios|android create`
- `runcloud ios|android list [--all]`
- `runcloud ios|android get <id>`
- `runcloud ios|android open-url <url> --id <id>`
- `runcloud ios|android delete <id>`

Create accepts `--model`, `--region`, `--display-name`, repeatable `--label`,
repeatable `--install`, repeatable `--install-asset`,
`--inactivity-timeout`, `--hard-timeout`, `--codec`, `--rm`, and `--json`.

Use assets and samples when no local artifact is ready:

```bash
runcloud sample download ios
runcloud ios create --install ./run-cloud-sample-ios.app.tar.gz --json

runcloud asset push ./build/MyApp.tar.gz --name my-app --json
runcloud ios create --install-asset my-app --json
runcloud asset list --json
runcloud asset pull <asset-id> --output ./MyApp.tar.gz
runcloud asset delete <asset-id> --json
```

iOS needs an Apple Silicon simulator-compatible `.app`, `.zip`, `.tar.gz`, or
`.ipa` artifact. A device-signed App Store IPA is not a substitute. Android
needs an emulator-compatible artifact such as an APK.

## Connect Local Development

Connect a local Metro or mock server to an active iOS session:

```bash
runcloud ios tunnel "$SESSION_ID" \
  --local-port 8081 \
  --service metro \
  --json

runcloud ios tunnel-status --json
```

Use the run.cloud sidecar flow. Do not install or expose an unauthenticated
third-party tunnel. If the sidecar is unavailable, report that requirement
instead of guessing a public URL.

## Use the TypeScript SDK

Install the SDK:

```bash
npm install @run-cloud/sdk
```

Always release metered sessions in `finally`:

```ts
import { writeFile } from "node:fs/promises";
import { Client } from "@run-cloud/sdk";

const cloud = new Client();
const session = await cloud.ios.create({
  displayName: "Agent smoke",
  labels: { owner: "agent" },
  inactivityTimeout: "60s",
  hardTimeout: "10m",
  codec: "auto",
});

try {
  await cloud.ios.openUrl(session.id, "https://run.cloud");
  const screenshot = await cloud.ios.screenshot(session.id);
  await writeFile("run-cloud.png", screenshot);
} finally {
  await cloud.ios.delete(session.id);
}
```

The mobile SDK surface is:

- `cloud.account()` and `cloud.usage({ orgId? })`
- `cloud.ios`: `create`, `list`, `get`, `openUrl`, `screenshot`,
  `uploadVideo`, `uploadMicrophoneAudio`, `delete`
- `cloud.android`: `create`, `list`, `get`, `openUrl`, `delete`
- `cloud.simulators`: runtime-platform `create`, `list`, `get`, `openUrl`,
  `delete`
- `cloud.assets`: `upload`, `list`, `delete`

Create options include `model`, `region`, `displayName`, `labels`,
`installAssets`, `inactivityTimeout`, `hardTimeout`, and `codec`.

Do not invent SDK methods for scripted taps, typing, recording, app lifecycle,
or Android screenshots. Browser-stream interaction and iframe commands are
separate from the public SDK.

## Inject iOS Media

Use `cloud.ios.uploadVideo(id, video, options)` for MP4 or QuickTime video. It
stores a user-owned asset and imports it into Photos.

Use `cloud.ios.uploadMicrophoneAudio(id, audio, options)` for AAC, M4A, MP3,
MP4-audio, or WAV. Pass an optional `bundleId`; otherwise it targets the
foreground app. The operation relaunches the target app with microphone
permission and loops the decoded audio through `AVAudioEngine`.

Delete uploaded assets when they are no longer needed.

## Embed a Session

- Add `embed=1` to the signed session URL for the clean iframe UI.
- Add `loadingGuard=1` when the iframe should block interaction until streaming
  and app launch are ready.
- Verify `event.source` is the expected iframe before processing messages.
- Handle `ios-simulator:status`, `ios-simulator:auth-error`,
  `ios-simulator:session-ended`, and
  `ios-simulator:session-restart-requested`.
- Create a new session after a restart request; never reuse an ended URL.
- Use `ios-simulator:command` for `reload`, `home`, `rotate`, `screenshot`, and
  `toggleAccessibility`.

## Run Maintained Demos

```bash
runcloud demo run eight-device-mosaic --open
runcloud demo run live-camera-relay --open
```

The bundled demos release their sessions automatically.

## Guardrails

- Release every session created during a task unless the user explicitly asks
  to keep it open.
- Use inactivity and hard timeouts for unattended work.
- Verify platform compatibility before changing application code after an
  install failure.
- Do not expose credentials, signed viewer URLs, tunnel URLs, or simulator
  tokens in logs, screenshots, PR comments, or chat output.
- Do not claim that browser iframe controls are public SDK methods.
