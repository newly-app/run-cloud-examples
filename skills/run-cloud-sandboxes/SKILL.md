---
name: run-cloud-sandboxes
description: Operate run.cloud microVM sandboxes with the CLI or TypeScript SDK. Use for creating isolated compute, running commands, moving files, managing snapshots or images, exposing ports, using SSH or desktop automation, attaching secrets, sizing resources, or cleaning up sandboxes.
---

# Operate run.cloud Sandboxes

Use the `runcloud` CLI for terminal and interactive workflows. Use
`@run-cloud/sdk` for TypeScript applications, CI, and agent code.

## Authenticate

- Install the CLI with `npm install -g runcloud`.
- Use `runcloud login` for an interactive browser handoff. Use
  `runcloud login --manual` when a local callback cannot open.
- In CI, set `RUN_CLOUD_API_KEY`. `RUN_CLOUD_API_TOKEN` is an equivalent alias.
- Set `RUN_CLOUD_API_URL` only to override the production default
  `https://api.run.cloud`.
- Never print, commit, or place credentials in a skill file.
- Treat signed desktop and tunnel URLs as bearer secrets.
- Require Node.js 20 or newer for the CLI and TypeScript SDK.

Inspect account and organization usage before starting metered work:

```bash
runcloud account --json
```

## Choose the Interface

- Prefer CLI commands with `--json` for shell automation.
- Prefer the TypeScript SDK when code needs streaming command output, binary
  file transfer, retry-safe creation, or short-lived public tunnels.
- Inspect `runcloud sandbox --help`, a subcommand's `--help`, or installed SDK
  types before using a method not documented here.
- Use the `sandbox` noun. The older `box` commands are deprecated aliases.

## Run a CLI Lifecycle

Create a sandbox, capture its ID, run a command, and destroy it:

```bash
SANDBOX_ID=$(runcloud sandbox create \
  --image runcloud/agent-base \
  --timeout 900 \
  --json | jq -r '.id')

trap 'runcloud sandbox rm "$SANDBOX_ID" >/dev/null 2>&1 || true' EXIT

runcloud sandbox get "$SANDBOX_ID" --json
runcloud sandbox exec "$SANDBOX_ID" "npm install && npm test"
```

The main lifecycle commands are:

- `runcloud sandbox create`
- `runcloud sandbox list [--state <state>]`
- `runcloud sandbox get <id>`
- `runcloud sandbox exec <id> <cmd...>`
- `runcloud sandbox shell <id>`
- `runcloud sandbox pause|resume <id>`
- `runcloud sandbox logs <id> [--lines <n>]`
- `runcloud sandbox metrics <id> [--range <range>] [--watch]`
- `runcloud sandbox rm <id>`

Create accepts `--image`, `--region`, `--name`, `--org`, `--cpu`, `--memory`,
`--disk`, `--idle-pause`, `--timeout`, `--persistent`, `--expose`, secret
selectors, `--no-wait`, and `--json`.

The default reservation is 0.125 vCPU and 128 MiB when CPU and memory are
omitted. Set finite timeouts for unattended work. Use `--timeout 0` only when a
persistent workload is intentional.

CLI `exec` runs through `/bin/sh -c` and returns the guest command's exit code.
A paused sandbox must be resumed before `exec`; `shell` resumes it
automatically.

## Use the TypeScript SDK

Install the SDK:

```bash
npm install @run-cloud/sdk
```

Use an idempotency key when a job runner may retry creation, check non-zero
exit codes explicitly, and always destroy metered resources:

```ts
import { Client } from "@run-cloud/sdk";

const cloud = new Client();
const sandbox = await cloud.sandboxes.create({
  image: "runcloud/agent-base",
  cpu: 1,
  memory: 1024,
  timeoutSeconds: 900,
  idempotencyKey: process.env.CI_JOB_ID,
});

try {
  const result = await cloud.sandboxes.exec(
    sandbox.id,
    ["npm", "test"],
    {
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`tests failed with exit code ${result.exitCode}`);
  }
} finally {
  await cloud.sandboxes.destroy(sandbox.id);
}
```

The TypeScript sandbox surface is:

- `cloud.sandboxes`: `create`, `list`, `get`, `exec`, `readFile`,
  `writeFile`, `openTunnel`, `closeTunnel`, `setTimeout`, `snapshot`,
  `destroy`, and the `delete` alias
- `cloud.snapshots`: `list`, `restore`, `delete`
- `cloud.account()` and `cloud.usage({ orgId? })`

A string passed to SDK `exec` runs through `/bin/sh -c`; an argv array executes
directly. A non-zero guest exit code is returned rather than thrown. Use
`cwd`, `env`, `timeoutSeconds`, `onStdout`, `onStderr`, and `signal` as needed.

Use `readFile` and `writeFile` for binary-safe SDK file transfer. For
interactive terminal workflows, configure SSH with `runcloud sandbox setup-ssh`
and inspect `runcloud sandbox ssh`, `cp`, and `code` help before use.

## Snapshot and Restore

Snapshot a prepared filesystem and restore it into fresh sandboxes:

```bash
runcloud sandbox snapshot create "$SANDBOX_ID" --label deps-installed --json
runcloud sandbox snapshot list --json
runcloud sandbox restore <snapshot-id> --json
runcloud sandbox snapshot rm <snapshot-id>
```

The SDK equivalents are `cloud.sandboxes.snapshot`,
`cloud.snapshots.restore`, `cloud.snapshots.list`, and
`cloud.snapshots.delete`.

A restore creates a new billed sandbox with a new ID. One snapshot can fan out
to parallel workers, but every restored sandbox counts toward concurrency and
must be destroyed. A restored sandbox inherits no secrets; attach only the
secrets it needs.

## Use Images

Use reusable images when every sandbox needs the same base tools:

```bash
runcloud image create my-agent --dockerfile ./Dockerfile
runcloud image list --json
runcloud sandbox create --image my-agent --json
runcloud image refresh my-agent
```

Inspect `runcloud image --help` for current build-source options. Do not invent
image methods on the TypeScript SDK.

## Expose a Service

Choose one exposure model deliberately:

- For a stable hostname, create with
  `runcloud sandbox create --name <name> --expose <port> --persistent`, or use
  `runcloud sandbox expose <id> --port <port>`.
- For a short-lived random URL in TypeScript, call
  `cloud.sandboxes.openTunnel(id, port, { ttlSeconds })`, then
  `closeTunnel(id, tunnel.id)`.

An SDK tunnel does not make the sandbox persistent or disable idle pause. Do
not log its URL. Revocation can take effect shortly after `closeTunnel`
returns; stop the guest service or destroy the sandbox when access must end
immediately.

## Handle Secrets Safely

- Create secret groups from `--from-dotenv`, `--from-json`, `--stdin`, a file,
  or a hidden prompt. Never pass a secret value as a command argument.
- Attach only the required groups or names with repeatable `--secret-group` and
  `--secret`. Later selectors win on name collisions; `--env` is applied last.
- Use `--no-secrets` to state explicitly that a new sandbox needs none.
- Treat `runcloud sandbox secrets <id> ...` as full replacement, not a merge.
- Remember that values cannot be read back and snapshots do not contain
  secrets.

Inspect `runcloud secret-group --help` and `runcloud secrets --help` for the
current non-plaintext input forms.

## Operate Desktop Sandboxes

For a compatible desktop image, use `runcloud sandbox desktop <id>` to open its
signed browser desktop. The CLI also provides `screenshot`, `click`, `type`,
and `key` subcommands for explicit pixel-coordinate automation. Keep signed
desktop URLs private and inspect each subcommand's help before automation.

## Guardrails

- Destroy every sandbox created during a task unless the user explicitly asks
  to keep it. Also remove unused snapshots, tunnels, and public hostnames.
- Use `try/finally` or a shell trap around every metered lifecycle.
- Check `exitCode`; do not treat a completed SDK `exec` call as success by
  itself.
- Do not expose API credentials, secret values, signed desktop URLs, or tunnel
  URLs in logs, screenshots, PR comments, or chat output.
- Do not claim that CLI-only lifecycle, image, secret-group, desktop, or stable
  hostname commands are TypeScript SDK methods.
