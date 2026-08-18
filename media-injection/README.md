# Native camera and microphone injection proof

This suite proves prerecorded camera and microphone input inside maintained native
Swift and Java apps on real run.cloud sessions. The API acknowledgement is only an
intermediate check: each app must independently recognize the injected signal in
captured frames or microphone samples before the test passes.

## Deterministic inputs and fingerprints

`generate-fixtures.mjs` creates both inputs locally and writes a manifest containing
their SHA-256 hashes:

| Input | Synthetic signal | Native pass fingerprint |
| --- | --- | --- |
| Camera | 640×480 MP4 with red, green, blue, and yellow quadrants at 10 fps | `RCAM-v1:RGBY`, three consecutive matching frames |
| Microphone | 48 kHz mono 16-bit WAV containing a 1000 Hz tone | `RAUD-v1:1000Hz`, three consecutive spectral windows near 1000 Hz |

The iOS fixture is in `ios-app-screenshot/App/MediaProof.swift`; the Android
fixture is in
`android-app-screenshot/App/cloud/run/examples/screenshot/MediaProofController.java`.
Both are selected with a `runcloudproof://media/<camera|microphone>` deep link and
publish their current result through the native accessibility hierarchy.

## Contract checks

The local checks generate both files, inspect the WAV samples, validate the MP4
container, and exercise the platform-neutral accessibility proof contract:

```bash
npm ci
npm test
```

The package lock installs a pinned `ffmpeg-static` binary, so local and CI fixture
generation use the same encoder release. The generated inputs are build artifacts
and are not checked into the repository.

## Authenticated E2E run

Build the two native apps using their documented `npm run build:app` commands.
Install current public packages in this directory, then run one platform/input
combination at a time:

```bash
npm install --no-save --no-package-lock @run-cloud/sdk@latest runcloud@latest

export RUN_CLOUD_API_KEY="rc_live_..."
export RUN_CLOUD_API_URL="https://api.run.cloud"
export RUN_CLOUD_MEDIA_PLATFORM="ios"       # ios or android
export RUN_CLOUD_MEDIA_INPUT="camera"       # camera or microphone
export RUN_CLOUD_MEDIA_RUN_ID="manual-$(date +%s)"
export RUN_CLOUD_MEDIA_APP="../ios-app-screenshot/build/RunCloudProof.app.tar.gz"
export RUN_CLOUD_MEDIA_ARTIFACT_DIR="$PWD/build/proof-ios-camera"
npm run test:live
```

For Android, point `RUN_CLOUD_MEDIA_APP` at
`../android-app-screenshot/build/RunCloudProof.apk`. Advanced package testing can
set `RUN_CLOUD_SDK_ENTRYPOINT` and `RUN_CLOUD_CLI_ENTRYPOINT` to release-shaped
package entrypoints; otherwise the harness uses this directory's installed public
packages.

Each combination creates separate sessions for the SDK and CLI injection paths so
the second assertion cannot reuse media left by the first. The suite releases every
session and deletes every app/media asset. Its retained evidence includes:

- fixture hashes and package versions in `runner.json`;
- stage start/pass/fail entries in `stages.jsonl`;
- SDK and CLI acknowledgements without signed URLs;
- armed and passing native accessibility trees;
- passing PNG screenshots and bounded simulator logs;
- `session-retries.json` and per-attempt diagnostics when a host accessibility
  endpoint remains explicitly retryable for 60 seconds; the harness uses at most
  three fresh sessions per public surface and never retries a native fingerprint
  mismatch or app-reported failure;
- `result.json`, `failure.json` when needed, and `cleanup.json`.

The repository's `Test examples` workflow builds the apps from source and exposes a
four-job `platform × input` live matrix behind its protected `live` environment,
which is configured with production credentials. The workflow rejects any proof that does not target
`https://api.run.cloud`. Camera and microphone jobs are serialized per platform to
respect mobile fleet capacity, and artifacts are retained even when a stage fails.
