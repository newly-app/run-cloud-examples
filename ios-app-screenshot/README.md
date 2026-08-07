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
npm run demo -- --json
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
--app FILE                   Upload an existing .app archive instead of building.
--output FILE                Save the PNG at a different path.
--ready-timeout-ms NUMBER    Wait 1000-300000 ms for an active session (default: 120000).
--settle-ms NUMBER           Wait 0-15000 ms before capture (default: 2000).
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
