---
name: run-cloud-ios-simulator
description: Use run.cloud SDK and CLI workflows for iOS simulator and Android emulator sessions.
version: 0.5.0
---

# run.cloud Mobile Sessions

Use this skill when a user asks an agent to create, inspect, smoke test, debug,
or release an iOS simulator or Android emulator through run.cloud.

## Requirements

- Read SDK credentials from `RUN_CLOUD_API_KEY`. Never print the key, commit it,
  or write it into a skill file.
- Use `RUN_CLOUD_API_URL` when set; otherwise use `https://api.newly.app`.
- Treat SDK API keys and CLI login tokens as separate credentials. TypeScript
  SDK and REST requests use `RUN_CLOUD_API_KEY`; interactive CLI commands use
  the session created by `runcloud login`.
- The TypeScript SDK requires Node.js 20 or newer.
- The account must have run.cloud access, available capacity, and a positive
  run.cloud balance.
- App artifacts must match the target platform. iOS sessions need
  simulator-compatible builds; Android sessions need Android-compatible
  artifacts such as APKs.

## TypeScript SDK

Prefer `@run-cloud/sdk` for applications, CI, and agent code:

```bash
npm install @run-cloud/sdk
```

Use the platform client when the platform is known, and always release metered
sessions in `finally`:

```ts
import { Client } from "@run-cloud/sdk";

const cloud = new Client();
const session = await cloud.ios.create({
  displayName: "Agent smoke",
  labels: { owner: "agent" },
  inactivityTimeout: "60s",
});

try {
  await cloud.ios.openUrl(session.id, "https://run.cloud");
  console.log(session.url);
} finally {
  await cloud.ios.delete(session.id);
}
```

Use `cloud.android` for Android. When the platform is selected at runtime, use
`cloud.simulators` and pass `session.platform` to `get`, `openUrl`, or `delete`.

The implemented SDK surface is:

- `cloud.account()`;
- `cloud.ios` and `cloud.android`: `create`, `list`, `get`, `openUrl`, `delete`;
- `cloud.simulators`: the same lifecycle with a runtime `platform` option;
- `cloud.assets`: `upload`, `list`, `delete`.

Do not invent screenshot, tap, typing, recording, app lifecycle, sandbox, build,
or compatibility-adapter methods. Check the installed package types and
https://run.cloud/cli/typescript-sdk before using a method not listed here.

## CLI Workflow

Use the CLI for interactive terminal work:

```bash
npm install -g runcloud
runcloud login
runcloud account --json
```

Create, inspect, open a URL, and release an iOS session:

```bash
runcloud ios create --install ./build/MyApp.tar.gz --json
runcloud ios get "$SESSION_ID" --json
runcloud ios open-url myapp://settings --id "$SESSION_ID"
runcloud ios delete "$SESSION_ID" --json
```

Use the corresponding `runcloud android` commands with an Android artifact for
Android emulator sessions.

## Runnable SDK Example

The maintained example checks account state, creates iOS and Android sessions,
opens a URL on each, and releases both sessions:

```bash
git clone --depth 1 https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/sdk-ios-android
npm install
npm run demo -- --platform both --open
```

Use `--platform ios` or `--platform android` for one platform. Use `--json` for
machine-readable output. The example releases sessions on completion, failure,
SIGINT, and SIGTERM unless the user explicitly passes `--keep`.

## Embedded Iframes

- Use `inactivityTimeout: "60s"` in the SDK, or
  `--inactivity-timeout 60s` in the CLI, when an embed should auto-close after
  user inactivity.
- Omit the option or pass `null`/`none` when the user needs a metered session
  without idle auto-close.
- Treat the returned signed session URL as a secret. Do not publish it in logs.
- Verify `event.source` before acting on simulator messages from an iframe.
- Create a fresh session after a restart request; do not reuse an ended iframe
  URL.

## Rules

- Prefer the SDK for code and `--json` CLI output for shell automation.
- Always release sessions created during a task unless the user asks to keep
  them open.
- If installation fails, verify that the artifact matches the target platform
  before changing code.
- Do not assume a local tunnel is installed on the user's machine.
- Do not expose API keys, CLI tokens, signed simulator URLs, or simulator tokens
  in logs or screenshots.
