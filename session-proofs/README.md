# Native session capability proofs

This directory runs authenticated production E2E checks for public run.cloud
session behavior that cannot be established with a fake simulator fleet:

- `capabilities.live.test.mjs` creates independent SDK and CLI sessions, opens
  an HTTPS URL, captures a real PNG, records the display, stops/finalizes the
  recording, and downloads and validates the resulting MP4.
- `expiry.live.test.mjs` creates a 90-second session, proves that SDK and CLI
  both see it active immediately before `expiresAt`, waits through the stated
  hard timeout, and requires both surfaces to see an automatic release. It
  also proves that the public usage meter stops increasing. On iOS it bootstraps
  a session cookie, proves that cookie can mint only a lease-bounded exec JWT,
  holds an authenticated exec WebSocket across expiry, and verifies the expired
  cookie, open socket, and a new handshake are all rejected.

The workflow installs the selected public `@run-cloud/sdk` and `runcloud`
versions rather than importing repository internals. No fake or mocked
simulator result is accepted.

## Local authenticated run

Install dependencies, then set a production-scoped API key without committing
it:

```bash
npm ci
npm install --no-save --no-package-lock @run-cloud/sdk@latest runcloud@latest

export RUN_CLOUD_API_KEY="rc_live_..."
export RUN_CLOUD_API_URL="https://api.run.cloud"
export RUN_CLOUD_PROOF_PLATFORM="ios" # ios or android
export RUN_CLOUD_PROOF_RUN_ID="manual-$(date +%s)"
export RUN_CLOUD_PROOF_ARTIFACT_DIR="$PWD/build/capabilities-ios"
npm run test:capabilities

export RUN_CLOUD_PROOF_ARTIFACT_DIR="$PWD/build/expiry-ios"
npm run test:expiry
```

Each stage is appended to `stages.jsonl`. Successful capability runs retain
SDK and CLI PNG/MP4 files plus recording metadata. Expiry runs retain the
pre-expiry and terminal state observations, usage samples, and sanitized cookie
and exec-expiry outcomes. Every run writes `result.json` or `failure.json` and a
`cleanup.json` resource ledger. Signed session URLs, API keys, and exec JWTs
are never written to artifacts.
