# Eight-device mosaic

Start eight run.cloud iOS simulator sessions, send each simulator to one tile
of a synchronized animated canvas, and embed the signed sessions in a local
4-by-2 mosaic viewer. The demo releases every session automatically after two
minutes. A ten-minute server-side timeout is also set in case the local process
is interrupted.

## Requirements

- Node.js 20 or newer
- `runcloud` 0.1.3 or newer: `npm install -g runcloud@0.1.3`
- An existing simulator account authenticated with `runcloud login`
- run.cloud simulator access, capacity, and enough balance for eight sessions

The local viewer binds only to `127.0.0.1`. Signed simulator URLs remain in the
viewer process and are not printed to the terminal.

## Run

```bash
npm run demo -- --open
```

The viewer shows all eight live devices as one coordinated canvas and releases
them after 120 seconds. To change the duration:

```bash
npm run demo -- --duration 60 --open
```

Press Ctrl+C or select **End demo** in the viewer to release the sessions early.
Omit `--open` when you only want the local viewer URL printed.

For a local or preview tile host, set `RUN_CLOUD_DEMO_ORIGIN` to its absolute
HTTP or HTTPS origin before starting the demo.
