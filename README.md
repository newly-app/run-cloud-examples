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

## Native accessibility benchmark

The maintained Swift and Java apps double as deterministic accessibility
benchmarks. A versioned contract documents their labels, roles, hierarchy,
values, secure-field redaction, and initial and post-interaction states. The
published-SDK suite installs both CI-built apps into real run.cloud sessions,
reads each native accessibility tree, taps controls by returned bounds, and
captures the resulting trees and screenshots.

See [accessibility-benchmark/README.md](accessibility-benchmark/README.md) for
the exact contract and live command.

## Examples

### Real iOS app screenshot

Build a native iOS app from Swift source, upload and launch it in a simulator,
then save a structurally validated, nonblank PNG. The fixture also registers
`runcloudproof` and displays the complete encoded URI delivered by a deep link.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/ios-app-screenshot
npm install
RUN_CLOUD_API_KEY="rc_live_..." npm run demo -- --json
```

Add `--prove-open-urls --open` to run the packaged SDK HTTPS and encoded
deep-link proof and watch the result. The iOS example also confirms the system
custom-scheme prompt through the authenticated SDK before capture. See
[ios-app-screenshot/README.md](ios-app-screenshot/README.md) for the exact
command, Xcode requirement, custom app archives, output paths, and cleanup.

### Real Android app screenshot

Build a native Android app from Java source, upload and launch its APK in an
emulator, then save a structurally validated, nonblank PNG. The fixture also
registers `runcloudproof` and displays the complete encoded URI delivered by a
deep link.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/android-app-screenshot
npm install
RUN_CLOUD_API_KEY="rc_live_..." npm run demo -- --json
```

Add `--prove-open-urls --open` to run the packaged SDK HTTPS and encoded
deep-link proof and watch the result. See
[android-app-screenshot/README.md](android-app-screenshot/README.md) for the
exact command, JDK and Android SDK requirements, custom APKs, JSON output, and
strict cleanup.

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

The manual GitHub Actions live job builds both native apps, then runs their
published-SDK accessibility benchmark inside a short-lived run.cloud sandbox.
To run either screenshot example directly:

```bash
cd ios-app-screenshot # or android-app-screenshot
export RUN_CLOUD_API_KEY="rc_live_..."
npm run demo -- --prove-open-urls --open --json
```

The live workflow is opt-in so normal pull requests never create paid sessions.
Every pull request still builds the native fixtures and publishes them as the
`run-cloud-parity-ios-app` and `run-cloud-parity-android-app` workflow artifacts.
On manual live dispatch, the Actions controller downloads those exact artifacts,
runs the test on a run.cloud runner, uploads TAP, JSON-tree, PNG, runner-identity,
and cleanup evidence, then repeats run-scoped cleanup in an `always()` step.

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
