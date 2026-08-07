# Upload a native Android app and take a screenshot

This example builds a small Android app from the included Java source, uploads
the APK, launches it in a run.cloud Android Emulator, and saves a validated PNG.

## Requirements

- JDK 17 or newer
- Android SDK platform 35 or newer with build tools installed
- `ANDROID_HOME` or `ANDROID_SDK_ROOT` set to that SDK
- Node.js 20 or newer
- a run.cloud API key with Android Emulator access and available credit

GitHub's Ubuntu hosted runners already include the JDK and Android SDK tools
used by `build-app.mjs`: `javac`, `d8`, `aapt2`, `zipalign`, and `apksigner`.

## Run it

```bash
npm install
export RUN_CLOUD_API_KEY="rc_live_..."
npm run demo -- --json
```

The command builds and uploads `RunCloudProof.apk`, waits for the session to
become active, allows the app UI to settle, validates the returned PNG's
structure, dimensions, and pixels, and writes
`screenshots/run-cloud-proof.png`.

The final JSON object is stable automation output:

```json
{
  "platform": "android",
  "sessionId": "sim_...",
  "assetId": "asset_...",
  "output": "/absolute/path/screenshots/run-cloud-proof.png",
  "byteSize": 123456,
  "width": 1080,
  "height": 2400,
  "cleanup": { "session": "released", "asset": "deleted" }
}
```

Progress goes to stderr when `--json` is used. The signed viewer URL is never
included in the output.

Cleanup is strict and ordered: the emulator is released before the uploaded
asset is deleted. Both deletions are attempted, and a cleanup failure makes the
command fail even if the screenshot was saved. The 60-second inactivity timeout
and ten-minute hard timeout are additional safeguards. Ctrl+C and SIGTERM cancel
the active operation, run the same cleanup, and return a nonzero exit code.

## Options

```text
--open                       Open the live viewer in the system browser.
--app FILE                   Upload an existing APK instead of building the sample.
--output FILE                Save the PNG at a different path.
--ready-timeout-ms NUMBER    Wait 1000-300000 ms for an active session (default: 120000).
--settle-ms NUMBER           Wait 0-15000 ms before capture (default: 2000).
--json                       Print one machine-readable result to stdout.
```

For example:

```bash
npm run demo -- \
  --app ./build/MyApp.apk \
  --output ./screenshots/my-app.png \
  --ready-timeout-ms 180000 \
  --json
```

The APK must support the Android Emulator architecture. The SDK checksums the
APK, uploads its binary bytes, and finalizes the asset before creating the
session. It handles the screenshot response as raw PNG bytes.

## Interaction-proof layout

The included app is also the deterministic fixture used by the simulator input
parity suite. Coordinates below are normalized to the full portrait screen;
`0,0` is top-left and `1,1` is bottom-right.

| Region | Accessibility description | Reference input |
| --- | --- | --- |
| Tap button | `tap-target` | tap `0.50,0.23` |
| Editable field | `text-input` | tap `0.50,0.30`, then enter text |
| Gesture pad | `gesture-area` | gesture from `0.38,0.43` to `0.62,0.46` |
| Scroll panel | `swipe-scroll` | swipe from `0.50,0.65` to `0.50,0.54` |

Visible state has descriptions `tap-state`, `swipe-state`, `gesture-state`, and
`key-state`. Every Android key-down event updates the last-key state, including
Control, Alt, Shift, and Meta modifiers; Enter also dismisses the text keyboard.
Prefer accessibility descriptions when the driver exposes them; the coordinates
are stable anchors for normalized input APIs.
