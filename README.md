# run.cloud examples

Runnable projects for trying run.cloud locally. Each example is self-contained
and includes its own requirements, commands, and cleanup behavior.

## Start with the TypeScript SDK

The SDK quickstart uses the same API-key flow and mobile session lifecycle as
the [run.cloud TypeScript SDK docs](https://docs.run.cloud/cli/typescript-sdk). It
checks account state, creates iOS and Android sessions, opens URLs, and releases
every session automatically.

```bash
git clone --depth 1 https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/sdk-ios-android
npm install
npm run demo -- --platform both --open
```

See [sdk-ios-android/README.md](sdk-ios-android/README.md) for platform, codec,
duration, JSON-output, and cleanup options.

## Examples

### Real iOS app screenshot

Build a native iOS app from Swift source, upload and launch it in a simulator,
then save the simulator screenshot as raw PNG bytes.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/ios-app-screenshot
npm install
RUN_CLOUD_API_KEY="rc_live_..." npm run demo -- --open
```

See [ios-app-screenshot/README.md](ios-app-screenshot/README.md) for the Xcode
requirement, custom app archives, output paths, and cleanup behavior.

### Eight-device mosaic

Coordinate eight live iOS simulator browsers into one synchronized 4-by-2
run.cloud display, then release every session automatically.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/eight-device-mosaic
npm run demo -- --open
```

See [eight-device-mosaic/README.md](eight-device-mosaic/README.md) for account
requirements and additional options.

### Live camera relay

Connect your webcam to one simulator camera, open the camera in an Expo web
app, and relay the real WebRTC video to two receiver simulators.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/live-camera-relay
npm install
npm run demo -- --open
```

See [live-camera-relay/README.md](live-camera-relay/README.md) for camera
permissions, session requirements, and the local Expo workflow.

## Verify the published onboarding

The published-artifact suite installs exact npm releases, exercises the SDK
against a mock API, installs the bundled agent skill, and scaffolds and verifies
the maintained CLI demos without creating metered sessions:

```bash
cd tests
npm ci
npm test
```

An opt-in live test creates one iOS simulator through the SDK, inspects and
controls it through the CLI, and releases it in `finally`:

```bash
cd tests
RUN_CLOUD_LIVE_E2E=1 \
RUN_CLOUD_API_KEY="rc_live_..." \
RUN_CLOUD_API_URL="https://api.newly.app" \
npm run test:live
```

Set `RUN_CLOUD_LIVE_PLATFORM=android` to test Android instead. The GitHub
Actions workflow exposes the same live test through an explicit manual dispatch
so normal pull requests never create paid sessions.

## Agent skill

The [run.cloud agent skill](skills/run-cloud-ios-simulator/SKILL.md) teaches
Claude Code, Codex, and Cursor the implemented SDK and CLI lifecycle, including
credential boundaries and required session cleanup.
