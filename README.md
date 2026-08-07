# run.cloud examples

Runnable projects for trying run.cloud locally. Each example has its own npm
package, requirements, commands, and cleanup behavior. The native screenshot
examples share the PNG and lifecycle checks in `lib/`.

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
then save a structurally validated, nonblank PNG.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/ios-app-screenshot
npm install
RUN_CLOUD_API_KEY="rc_live_..." npm run demo -- --json
```

See [ios-app-screenshot/README.md](ios-app-screenshot/README.md) for the Xcode
requirement, custom app archives, output paths, and cleanup behavior.

### Real Android app screenshot

Build a native Android app from Java source, upload and launch its APK in an
emulator, then save a structurally validated, nonblank PNG.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/android-app-screenshot
npm install
RUN_CLOUD_API_KEY="rc_live_..." npm run demo -- --json
```

See [android-app-screenshot/README.md](android-app-screenshot/README.md) for the
JDK and Android SDK requirements, custom APKs, JSON output, and strict cleanup.

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
against a mock API, installs the bundled agent skills, and scaffolds and verifies
the maintained CLI demos without creating metered sessions:

```bash
cd tests
npm ci
npm test
```

The manual GitHub Actions live matrix builds and executes both native screenshot
examples against production. To run either example directly:

```bash
cd ios-app-screenshot # or android-app-screenshot
export RUN_CLOUD_API_KEY="rc_live_..."
npm run demo -- --json
```

The live workflow is opt-in so normal pull requests never create paid sessions.
Every pull request still builds the native fixtures and publishes them as the
`run-cloud-parity-ios-app` and `run-cloud-parity-android-app` workflow artifacts.
The live matrix downloads those artifacts before it creates a session.

## Agent skills

[![skills.sh](https://skills.sh/b/newly-app/run-cloud-examples)](https://skills.sh/newly-app/run-cloud-examples)

Install all three run.cloud skills for Claude Code, Codex, Cursor, and other
supported agents:

```bash
npx skills add newly-app/run-cloud-examples
```

The package contains:

- [`run-cloud`](skills/run-cloud/SKILL.md), a thin router that points agents to
  the appropriate focused skill
- [`run-cloud-ios-simulator`](skills/run-cloud-ios-simulator/SKILL.md), for
  remote iOS simulator and Android emulator sessions
- [`run-cloud-sandboxes`](skills/run-cloud-sandboxes/SKILL.md), for microVM
  compute, commands, files, snapshots, images, networking, secrets, and cleanup

To install only one focused skill, pass `--skill run-cloud-ios-simulator` or
`--skill run-cloud-sandboxes`.
