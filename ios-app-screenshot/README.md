# Upload a native iOS app and take a screenshot

This example builds a small UIKit app from the included Swift source, uploads
the simulator archive, launches it in run.cloud, and saves a validated PNG.

## Requirements

- macOS with Xcode and the iOS Simulator SDK
- Node.js 20 or newer
- a run.cloud API key with iOS Simulator access and available credit

## Run it

```bash
npm install
export RUN_CLOUD_API_KEY="rc_live_..."
npm run demo -- --prove-open-urls --open --json
```

The command builds and uploads `RunCloudProof.app.tar.gz`, waits for the session
to become active, allows the app UI to settle, validates the returned PNG's
structure, dimensions, and pixels, and writes
`screenshots/run-cloud-proof.png`.

The final JSON object is stable automation output:

```json
{
  "platform": "ios",
  "sessionId": "sim_...",
  "assetId": "asset_...",
  "output": "/absolute/path/screenshots/run-cloud-proof.png",
  "byteSize": 123456,
  "width": 1179,
  "height": 2556,
  "openUrls": {
    "https": {
      "ok": true,
      "platform": "ios",
      "sessionId": "sim_...",
      "device": "device_...",
      "leaseId": "lease_...",
      "url": "https://example.com/search?q=run%20cloud&return=%2Fdocs%3Ftab%3Dmobile"
    },
    "deepLink": {
      "ok": true,
      "platform": "ios",
      "sessionId": "sim_...",
      "device": "device_...",
      "leaseId": "lease_...",
      "url": "runcloudproof://open/items%2F42?message=hello%20world&return=https%3A%2F%2Fexample.com%2Fdone%3Fx%3D1%26y%3Dtwo#proof"
    }
  },
  "cleanup": { "session": "released", "asset": "deleted" }
}
```

Progress goes to stderr when `--json` is used. The signed viewer URL is never
included in the output.

Cleanup is strict and ordered: the simulator is released before the uploaded
asset is deleted. Both deletions are attempted, and a cleanup failure makes the
command fail even if the screenshot was saved. The 60-second inactivity timeout
and ten-minute hard timeout are additional safeguards. Ctrl+C and SIGTERM cancel
the active operation, run the same cleanup, and return a nonzero exit code.

## Options

```text
--open                       Open the live viewer in the system browser.
--prove-open-urls            Open encoded HTTPS and runcloudproof targets through the SDK.
--app FILE                   Upload an existing .app archive instead of building.
--output FILE                Save the PNG at a different path.
--ready-timeout-ms NUMBER    Wait 1000-300000 ms for an active session (default: 120000).
--settle-ms NUMBER           Settle before capture (default: 2000; URL proof minimum: 5000).
--json                       Print one machine-readable result to stdout.
```

For example:

```bash
npm run demo -- \
  --app ./build/MyApp.app.tar.gz \
  --output ./screenshots/my-app.png \
  --ready-timeout-ms 180000 \
  --json
```

The archive must contain an Apple Silicon iOS Simulator build, not a
device-signed App Store IPA. The SDK checksums the archive, uploads its binary
bytes, and finalizes the asset before creating the session. It handles the
screenshot response as raw PNG bytes.

## Deep-link proof

The included app registers the synthetic `runcloudproof` scheme. It handles a
link that starts the app and another delivered while the app is already running.
In both cases, an overlay with accessibility identifier `deep-link-state` shows
the complete encoded URI received from iOS.

The documented `npm run demo -- --prove-open-urls --open --json` command uses
the installed `@run-cloud/sdk` package to open the encoded HTTPS target first,
then the deep link. It verifies both six-field acknowledgements, captures the
app overlay after the deep link, and never prints the signed viewer URL. The
demo dismisses Safari's fresh-session Start Page after the HTTPS check so it
cannot delay the following custom-scheme confirmation. The
first custom-scheme handoff can show the iOS **Open in Run Cloud Proof?**
confirmation even after the URL operation succeeds. The demo waits for that
prompt for at least five seconds, confirms its **Open** button with an
authenticated SDK tap, then waits at least five more seconds for the proof app
to render before capture. If the prompt was already accepted, the same tap is
harmless on this fixture. The repository's live workflow invokes the same proof
against its CI-built app:

```bash
npm run demo -- \
  --app "$RUNNER_TEMP/native-app/RunCloudProof.app.tar.gz" \
  --output "$RUNNER_TEMP/ios-run-cloud-proof.png" \
  --prove-open-urls \
  --json
```

To repeat the custom-scheme step with the packaged CLI, build and install the
fixture, then open the same fully encoded target:

```bash
npm run build:app

SESSION_ID=$(runcloud ios create \
  --install ./build/RunCloudProof.app.tar.gz \
  --json | jq -r '.id')
trap 'runcloud ios delete "$SESSION_ID" >/dev/null 2>&1 || true' EXIT

DEEP_LINK='runcloudproof://open/items%2F42?message=hello%20world&return=https%3A%2F%2Fexample.com%2Fdone%3Fx%3D1%26y%3Dtwo#proof'
runcloud ios open-url "$DEEP_LINK" --id "$SESSION_ID" --json
```

The overlay should show the same URI byte for byte after the `Deep link
(cold):` or `Deep link (warm):` label. Keep the shell quotes: `&` and `#` are
part of the URI, not shell syntax.

## Interaction-proof layout

The included app is also the deterministic fixture used by the simulator input
parity suite. Reference coordinates below are normalized to the initial full
portrait screen; `0,0` is top-left and `1,1` is bottom-right. The page scrolls
when a shorter or landscape viewport cannot show every target at once. After a
rotation, prefer the accessibility identifiers or transform the coordinates
for the current orientation.

| Region | Accessibility identifier | Reference input |
| --- | --- | --- |
| Tap button | `tap-target` | tap `0.50,0.23` |
| Editable field | `text-input` | tap `0.50,0.30`, then enter text |
| Gesture pad | `gesture-area` | gesture from `0.38,0.43` to `0.62,0.46` |
| Scroll panel | `swipe-scroll` | swipe from `0.50,0.65` to `0.50,0.54` |

Visible state has identifiers `tap-state`, `swipe-state`, `gesture-state`, and
`key-state`. The app recognizes arrow, Enter, and Escape key commands and shows
the last received key with Control, Option, Shift, or Command modifiers. Prefer
accessibility identifiers when the driver exposes them; the coordinates are
stable anchors for normalized input APIs.

The final card is an accessibility-testing fixture. It contains a heading,
nested status labels, an editable name field, a prefilled secure password
field, a notifications switch, a disabled submit button, and a navigation
button. Reading the hierarchy after scrolling to the card can verify roles,
labels, bounds, identifiers, nesting, disabled state, secure-value redaction,
and fresh switch or navigation state.
