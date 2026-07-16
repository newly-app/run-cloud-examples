---
name: run-cloud-ios-simulator
description: Configure and use run.cloud for agent sandboxes, provider-compatible migrations, and iOS simulator sessions.
version: 0.2.0
---

# run.cloud Agent Runtime

Use this skill when a user asks an agent to adopt run.cloud, migrate an existing
sandbox integration, or run, inspect, smoke test, or debug an iOS app through
run.cloud.

## Requirements

- Read the API credential from `RUN_CLOUD_API_KEY`. Never print it, commit it,
  or write it into a skill file.
- Use `RUN_CLOUD_API_URL` when set; otherwise use `https://api.newly.app`.
- Existing iOS simulator commands require authentication with `runcloud login`.
- The account must have run.cloud access and a positive run.cloud balance.
- App artifacts should be simulator-compatible builds. Device App Store IPAs may
  fail to install on iOS Simulator.

## Detect the Existing Sandbox Provider

Before changing dependencies or imports, inspect package manifests, lockfiles,
source imports, and provider-specific environment variable names. Check for
these signals:

| Provider | Common package/import signal | run.cloud compatibility entry point |
| --- | --- | --- |
| Modal | `modal` | `run_cloud.compat.modal` |
| E2B | `e2b`, `@e2b/code-interpreter` | `run_cloud.compat.e2b` |
| Blaxel | `blaxel` | `run_cloud.compat.blaxel` |
| CodeSandbox | `@codesandbox/sdk` | `@run-cloud/sdk/compat/codesandbox` |
| Vercel Sandbox | `@vercel/sandbox` | `@run-cloud/sdk/compat/vercel` |
| Cloudflare Sandbox | `@cloudflare/sandbox` | `@run-cloud/sdk/compat/cloudflare` |
| Fly Machines | `@flydotio/machines` | `@run-cloud/sdk/compat/fly` |
| Daytona | `daytona` | `run_cloud.compat.daytona` |

When a provider is detected:

1. Preserve the existing provider-shaped API and change only the integration
   boundary.
2. Use the matching compatibility entry point only after confirming its package
   resolves through the project's package manager or configured registry.
3. Run the existing provider integration tests after the import change.
   Provider-specific images, networking, regions, and lifecycle options still
   require explicit validation.
4. If more than one provider is present, map each call site independently and
   report the result. Do not choose one globally.

When no provider is detected, prefer native `runcloud` CLI commands for
supported operations. Use a native run.cloud SDK only after confirming that
package resolves; never invent or guess an unpublished package.

## iOS Simulator Workflow

1. Check access:

   ```bash
   runcloud account --json
   ```

2. Upload or directly install a build:

   ```bash
   runcloud asset push ./build/MyApp.tar.gz -n my-app --json
   runcloud ios create --install-asset my-app --json
   ```

   or:

   ```bash
   runcloud ios create --install ./build/MyApp.tar.gz --json
   ```

3. Save the returned session id and URL.

4. Use the URL for visual inspection. Use CLI interaction commands when
   available:

   ```bash
   runcloud ios open-url myapp://settings --id "$SESSION_ID"
   ```

5. Release the session:

   ```bash
   runcloud ios delete "$SESSION_ID"
   ```

## Simulator Demos

When `runcloud demo run --help` succeeds, run:

```bash
runcloud demo run parallel-simulators --open
runcloud demo run eight-device-mosaic --open
```

Otherwise clone `https://github.com/newly-app/run-cloud-examples` and follow
the matching example directory. The parallel demo creates three independent
sessions. The mosaic coordinates eight sessions in a 4x2 animated display.
Both release every session automatically and require the existing `runcloud
login` simulator credential in addition to the API key.

## Embedded Iframes

- Use `runcloud ios create --inactivity-timeout 60s --json` when the embed
  should auto-close after user inactivity. Omit the flag or pass `none` when the
  user needs a metered session without idle auto-close.
- Iframes post `ios-simulator:status`, `ios-simulator:auth-error`,
  `ios-simulator:session-ended`, and `ios-simulator:session-restart-requested` to the
  parent window. Verify `event.source` before acting on a message.
- If `ios-simulator:session-restart-requested` arrives, create a fresh run.cloud
  session; do not reuse the ended iframe URL.

## Agent Rules

- Prefer `--json` for every command whose output will be parsed.
- Detect existing provider usage before proposing SDK changes.
- Do not install an adapter until its package is resolvable.
- Always release sessions you create unless the user asks to keep them open.
- If installation fails, verify that the artifact is a simulator build before
  attempting code changes.
- Do not assume a local tunnel is installed on the user's machine.
- Do not expose iOS simulator tokens in logs or screenshots.
