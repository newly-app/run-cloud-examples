# run.cloud examples

Runnable projects for trying run.cloud locally. Each example is self-contained
and includes its own requirements, commands, and cleanup behavior.

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

### SDK iOS and Android sessions

Use `@run-cloud/sdk` to create iOS simulator and Android emulator sessions,
open URLs inside them, and release sessions from TypeScript or Node.js code.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/sdk-ios-android
npm install
npm run demo -- --platform both --open
```

See [sdk-ios-android/README.md](sdk-ios-android/README.md) for API key setup,
platform-specific options, and cleanup behavior.

## Agent skill

The [run.cloud agent skill](skills/run-cloud-ios-simulator/SKILL.md) helps
Claude Code, Codex, and Cursor detect an existing sandbox provider before
choosing a native run.cloud integration or a compatible migration path.
