# Upload a real iOS app and take a screenshot

This example builds a small native iOS app from the included Swift source,
uploads the simulator app archive, launches it in a run.cloud session, and
saves a screenshot to disk.

The app archive is sent as a multipart upload. The screenshot API returns raw
PNG bytes, so neither binary is embedded in JSON.

## Requirements

- macOS with Xcode and the iOS Simulator SDK
- Node.js 20 or newer
- a run.cloud API key with iOS simulator access and available balance

## Run it

```bash
npm install
export RUN_CLOUD_API_KEY="rc_live_..."
npm run demo -- --open
```

The command:

1. compiles `App/AppDelegate.swift` into a simulator-compatible `.app`;
2. packages and uploads the app;
3. creates a simulator with that asset installed;
4. waits briefly for the UI to settle;
5. captures `screenshots/run-cloud-proof.png`;
6. releases the simulator and deletes the uploaded asset in `finally`.

The session uses a 60-second inactivity timeout and a five-minute hard timeout
as additional cleanup safeguards.

## Options

```text
--open                 Open the live simulator viewer.
--app FILE             Upload an existing .app archive instead of building the sample.
--output FILE          Save the PNG at a different path.
--settle-ms NUMBER     Wait 0-15000 ms before capture (default: 2000).
```

For example:

```bash
npm run demo -- \
  --app ./build/MyApp.app.tar.gz \
  --output ./screenshots/my-app.png
```

The archive must contain an iOS Simulator build, not a device-signed App Store
IPA.
