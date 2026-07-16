# Live camera relay

Start three run.cloud iOS simulator sessions: one camera broadcaster and two
receivers. A local viewer connects your computer webcam to the broadcaster
simulator's camera. The Expo web app opens that camera, shows the local preview,
and sends the real WebRTC video stream to both receiver simulators.

## Requirements

- Node.js 20 or newer
- `runcloud` 0.1.3 or newer: `npm install -g runcloud@0.1.3`
- An existing simulator account authenticated with `runcloud login`
- run.cloud simulator access, capacity, and enough balance for three sessions
- A browser with webcam permission

The local viewer binds only to `127.0.0.1`. Signed simulator URLs and camera
credentials remain inside the viewer process and are not printed to the
terminal. Every simulator is released automatically after two minutes. A
ten-minute server-side timeout is also set in case the local process exits.

## Run the live demo

```bash
npm run demo -- --open
```

In the local viewer:

1. Select **Connect webcam** and allow browser camera access.
2. In the broadcaster simulator, select **Start camera** and allow camera access.
3. The two receivers display the broadcaster's stream.

The simulator camera passthrough carries video frames. The app requests an
audio track when the simulator provides one; otherwise receivers show a flat
waveform labeled **NO TRACK** instead of simulating audio.

Press Ctrl+C or select **End demo** to release all sessions early. Use
`--duration 60` to choose a duration between 1 and 600 seconds.

## Work on the Expo app

```bash
npm install
npm run web
```

Open a broadcaster and two receivers with the same room id:

```text
/?role=broadcaster&room=local-camera-room
/?role=receiver&receiver=1&room=local-camera-room
/?role=receiver&receiver=2&room=local-camera-room
```

Set `RUN_CLOUD_CAMERA_DEMO_URL` to an absolute HTTP or HTTPS app URL when
testing a local or preview deployment with the simulator controller.
