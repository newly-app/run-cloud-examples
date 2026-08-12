# Native accessibility benchmark

This benchmark uses the repository's maintained Swift and Java applications to
exercise the public `@run-cloud/sdk` against real iOS Simulator and Android
Emulator sessions. No benchmark binary is downloaded. The source, build scripts,
and resulting apps are covered by the repository's MIT license.

The canonical machine-readable contract is
[`contract.v1.json`](contract.v1.json). The test checks the complete returned
schema, unique node IDs and paths, native hierarchy, roles, labels, values,
bounds, and states. Secure source text must never appear in a captured tree.

## Apps and build outputs

| Platform | Maintained source | Build output | Runtime requirement |
| --- | --- | --- | --- |
| iOS | `ios-app-screenshot/App/AppDelegate.swift` | `RunCloudProof.app.tar.gz` | Apple Silicon iOS Simulator |
| Android | `android-app-screenshot/App/cloud/run/examples/screenshot/MainActivity.java` | `RunCloudProof.apk` | Android emulator, API 23 or newer |

Both apps place the controls below the interaction fixture in this documented
depth-first order: heading, nested status, combined status, name field, secure
password field, notifications switch, disabled submit button, and navigation
button. iOS exposes them below an application root. Android exposes them in the
nested activity layout; layout wrappers can differ by OS image, while the order
and named descendants are fixed.

## Labels, values, and states

| Element | Label or identifier | Initial value/state |
| --- | --- | --- |
| Heading | `ACCESSIBILITY PROOF`; iOS identifier `accessibility-heading` | heading |
| Nested status | `Nested label: overview`; iOS identifier `nested-label` | text |
| Combined status | `Notifications: off · Screen: overview`; iOS identifier `accessibility-state` | text |
| Name | `Name`; iOS identifier `name-field` | value `Ada`, editable, not secure |
| Password | `Password`; iOS identifier `password-field` | value `null`, editable, secure |
| Switch | `Notifications`; iOS identifier `notifications-toggle` | unchecked |
| Submit | `Submit`; iOS identifier `disabled-submit` | disabled |
| Navigation | `Open details`; iOS identifier `navigate-button` | enabled |

The live test locates the switch from the returned tree bounds and taps it with
the public SDK. The expected state is `Notifications: on · Screen: overview`,
with `Nested label: overview`, a checked switch, and `Open details` unchanged.
It then locates and taps the navigation button. The final state is
`Notifications: on · Screen: details`, `Nested label: details`, a checked
switch, and `Back to overview`.

## Run the contract checks

```bash
npm ci
npm test
```

## Run against real run.cloud sessions

Build each app using its own `npm run build:app`, then run:

```bash
export RUN_CLOUD_API_KEY="rc_live_..."
export RUN_CLOUD_API_URL="https://api.run.cloud"
export RUN_CLOUD_BENCHMARK_RUN_ID="manual-$(date +%s)"
export RUN_CLOUD_BENCHMARK_IOS_APP="../ios-app-screenshot/build/RunCloudProof.app.tar.gz"
export RUN_CLOUD_BENCHMARK_ANDROID_APP="../android-app-screenshot/build/RunCloudProof.apk"
export RUN_CLOUD_BENCHMARK_ARTIFACT_DIR="./artifacts"
npm run test:live
```

Set `RUN_CLOUD_BENCHMARK_PLATFORM=ios` or `android` and
`RUN_CLOUD_BENCHMARK_APP=/absolute/path/to/the/app` to run one platform, as the
repository's existing `Test examples` live matrix does.

The suite creates one platform session at a time, uploads and installs the
matching app, writes the initial and post-interaction trees plus PNG screenshots,
and releases the session before deleting its asset. Every session has a
three-minute inactivity timeout and ten-minute hard timeout. Failure artifacts
contain sanitized errors, while cleanup artifacts record the session and asset
outcomes without signed viewer URLs or credentials. CI artifacts also include
the GitHub Actions runner identity, public SDK version, and native-app checksum.
