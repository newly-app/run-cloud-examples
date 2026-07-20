# run.cloud examples

Runnable projects for trying run.cloud locally. Each example is self-contained
and includes its own requirements, commands, and cleanup behavior.

## Start with the TypeScript SDK

The SDK quickstart uses the same API-key flow and mobile session lifecycle as
the [run.cloud TypeScript SDK docs](https://run.cloud/cli/typescript-sdk). It
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

### Parallel iOS simulators

Start two or three iOS simulator sessions concurrently, open a different page
in each, and automatically release every session when the demo finishes.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/parallel-simulators
npm run demo -- --count 3 --duration 120 --open
```

See [parallel-simulators/README.md](parallel-simulators/README.md) for account
requirements and additional options.

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

## Agent skill

The [run.cloud agent skill](skills/run-cloud-ios-simulator/SKILL.md) teaches
Claude Code, Codex, and Cursor the implemented SDK and CLI lifecycle, including
credential boundaries and required session cleanup.
