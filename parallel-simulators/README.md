# Parallel iOS simulators

Start two or three run.cloud iOS simulator sessions at the same time, open a
different site in each simulator, and view the live sessions side by side.
The demo releases every session automatically after two minutes. A ten-minute
server-side timeout is also set in case the local process is interrupted.

## Requirements

- Node.js 20 or newer
- `runcloud` 0.1.2 or newer: `npm install -g runcloud`
- An existing simulator account authenticated with `runcloud login`
- run.cloud simulator access and enough balance for two or three sessions

## Run

```bash
npm install -g runcloud
runcloud login
npm run demo -- --open
```

The default starts three sessions, opens the session URLs in browser tabs, and
releases the sessions after 120 seconds. To run a smaller or shorter demo:

```bash
npm run demo -- --count 2 --duration 60 --open
```

Press Ctrl+C to release the sessions early. Omit `--open` when you only want
the live session URLs printed to the terminal.
