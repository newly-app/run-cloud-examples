---
name: run-cloud
description: Route run.cloud work to the focused mobile-session or sandbox skill. Use when a request mentions run.cloud generally, spans both products, or does not yet distinguish remote iOS and Android sessions from microVM sandboxes.
---

# Route run.cloud Work

Keep this skill as a router. Do not duplicate operational instructions here.

- Use `$run-cloud-ios-simulator` for remote iOS simulators, Android emulators,
  app installation, mobile smoke tests, simulator screenshots, media injection,
  iframe embeds, Metro tunnels, mobile assets, and mobile session cleanup.
- Use `$run-cloud-sandboxes` for microVM sandboxes, command execution, files,
  snapshots, images, SSH, secrets, public ports, desktop automation, resource
  sizing, and sandbox cleanup.
- Use both focused skills when a workflow genuinely combines mobile sessions
  and sandboxes. Follow each skill's authentication, security, metering, and
  cleanup guardrails.

If the request is ambiguous, infer the product from the resource noun and
desired outcome. Ask only when choosing the wrong product would materially
change the work.
