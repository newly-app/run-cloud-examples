# Parallel iOS simulators

Start two or three run.cloud iOS simulator sessions at the same time, open a
different site in each simulator, and view the live sessions side by side.
The demo releases every session automatically after two minutes. A ten-minute
server-side timeout is also set in case the local process is interrupted.

## Requirements

- Node.js 20 or newer
- `runcloud` 0.1.3 or newer: `npm install -g runcloud`
- A simulator account authenticated either with `runcloud login` or with both
  `RUN_CLOUD_API_KEY` and `RUN_CLOUD_API_URL`
- run.cloud simulator access and enough balance for two or three sessions

## Run

```bash
npm install -g runcloud
npm run demo -- --open
```

Before running the demo, either save a browser-authenticated credential with
`runcloud login`, or export both `RUN_CLOUD_API_KEY` and `RUN_CLOUD_API_URL`.
The demo does not require both authentication methods.

The default starts three sessions, opens the session URLs in browser tabs, and
releases the sessions after 120 seconds. To run a smaller or shorter demo:

```bash
npm run demo -- --count 2 --duration 60 --open
```

Press Ctrl+C to release the sessions early. Omit `--open` when you only want
the live session URLs printed to the terminal.
