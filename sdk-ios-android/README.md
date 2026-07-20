# SDK iOS and Android sessions

Create iOS simulator and Android emulator sessions with `@run-cloud/sdk`, open
URLs inside them, and release every session when the demo exits.

## Requirements

- Node.js 20 or newer
- A run.cloud API key with `run_cloud.read` and `run_cloud.write` scopes
- run.cloud simulator access, capacity, and enough balance for the requested
  sessions

```bash
export RUN_CLOUD_API_KEY="rc_..."
npm install
```

`RUN_CLOUD_API_URL` can point the SDK at a non-default API host.

## Run both platforms

```bash
npm run demo -- --platform both --open
```

## Run one platform

```bash
npm run demo -- --platform ios --ios-url https://newly.app --open
npm run demo -- --platform android --android-url https://run.cloud --open
```

## Select a stream codec

The API default is `auto`. You can force MJPEG or WebRTC when comparing stream
paths:

```bash
npm run demo -- --platform ios --codec mjpeg
npm run demo -- --platform android --codec webrtc
```

## Print machine-readable session details

```bash
npm run demo -- --platform both --json
```

The demo keeps sessions alive for 120 seconds by default. Change that with
`--duration`:

```bash
npm run demo -- --platform both --duration 60
```

Press Ctrl+C to release sessions early. Add `--keep` to leave sessions running
after the command prints their URLs.
