import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const DEVICE_COUNT = 8;
const COLUMNS = 4;
const ROWS = 2;

export function parseOptions(args) {
  const options = { duration: 120, open: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--open') {
      options.open = true;
      continue;
    }
    if (argument === '--duration') {
      const raw = args[index + 1];
      if (!raw) throw new Error('--duration requires a value.');
      options.duration = Number(raw);
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (!Number.isInteger(options.duration) || options.duration < 1 || options.duration > 600) {
    throw new Error('--duration must be between 1 and 600 seconds.');
  }
  return options;
}

function runCloud(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.RUNCLOUD_BIN || 'runcloud', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `runcloud exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`runcloud returned invalid JSON: ${stdout.trim()}`));
      }
    });
  });
}

export function browserCommand(url, platform = process.platform) {
  return platform === 'darwin'
    ? ['open', [url]]
    : platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
}

function openBrowser(url) {
  const command = browserCommand(url);
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function embedUrl(value) {
  const url = new URL(value);
  url.searchParams.set('loadingGuard', '1');
  return url.toString();
}

export function mosaicViewerHtml(sessions, duration, now = Date.now()) {
  const frames = sessions.map((session, index) => `
        <section class="tile" data-tile="${index}">
          <iframe title="Mosaic device ${index + 1}" src="${escapeHtml(embedUrl(session.url))}" allow="clipboard-read; clipboard-write"></iframe>
          <span class="tile-number">${String(index + 1).padStart(2, '0')}</span>
        </section>`).join('');
  const deadline = now + duration * 1000;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>run.cloud eight-device mosaic</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #030404; color: #f8fafc; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { display: grid; grid-template-rows: 58px minmax(0, 1fr); background: #030404; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid rgba(255,255,255,.12); padding: 0 18px; background: #070909; }
      .brand, .status, .actions { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .brand-mark { width: 22px; height: 14px; border: 2px solid #67e8f9; transform: skewX(-18deg); }
      .brand strong { font-size: 14px; font-weight: 700; }
      .brand span, .status { color: #94a3b8; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
      .status b { color: #bef264; font-weight: 600; }
      #timer { width: 48px; color: #e2e8f0; text-align: right; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
      button { height: 34px; border: 1px solid rgba(255,255,255,.18); border-radius: 4px; padding: 0 12px; background: transparent; color: #f8fafc; cursor: pointer; font: 600 12px ui-sans-serif, system-ui, sans-serif; }
      button:hover { border-color: rgba(251,113,133,.7); color: #fda4af; }
      main { min-height: 0; display: grid; place-items: center; padding: 8px; }
      .mosaic { display: grid; grid-template-columns: repeat(${COLUMNS}, minmax(0, 1fr)); grid-template-rows: repeat(${ROWS}, minmax(0, 1fr)); gap: 5px; width: min(calc(100vw - 16px), calc((100vh - 74px) * 0.924)); height: min(calc(100vh - 74px), calc((100vw - 16px) / 0.924)); background: #111; }
      .tile { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #080b0b; }
      iframe { display: block; width: 100%; height: 100%; border: 0; }
      .tile-number { position: absolute; top: 6px; left: 7px; z-index: 2; color: rgba(255,255,255,.55); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; pointer-events: none; transition: opacity 300ms ease; }
      .tile[data-ready="true"] .tile-number { opacity: .18; }
      .tile[data-ended="true"]::after { content: "ENDED"; position: absolute; inset: 0; display: grid; place-items: center; background: rgba(3,4,4,.82); color: #fda4af; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
      @media (max-width: 680px) {
        header { padding: 0 10px; }
        .brand span { display: none; }
        .status { font-size: 10px; }
        button { width: 34px; padding: 0; font-size: 0; }
        button::after { content: "×"; font-size: 20px; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="brand"><i class="brand-mark"></i><strong>run.cloud</strong><span>MOSAIC 08</span></div>
      <div class="status"><b id="ready-count">0/${DEVICE_COUNT} LIVE</b><span id="timer">--:--</span></div>
      <div class="actions"><button id="finish" type="button">End demo</button></div>
    </header>
    <main><div class="mosaic">${frames}</div></main>
    <script>
      const deadline = ${deadline};
      const tiles = [...document.querySelectorAll('.tile')];
      const frames = [...document.querySelectorAll('iframe')];
      const ready = new Set();
      const count = document.querySelector('#ready-count');
      const timer = document.querySelector('#timer');
      const tick = () => {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        timer.textContent = String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0');
      };
      tick();
      setInterval(tick, 250);
      window.addEventListener('message', (event) => {
        const index = frames.findIndex((frame) => frame.contentWindow === event.source);
        if (index < 0 || !event.data || typeof event.data !== 'object') return;
        if (event.data.type === 'ios-simulator:status' && event.data.streaming === true) {
          ready.add(index);
          tiles[index].dataset.ready = 'true';
          count.textContent = ready.size + '/${DEVICE_COUNT} LIVE';
        }
        if (event.data.type === 'ios-simulator:session-ended') tiles[index].dataset.ended = 'true';
      });
      document.querySelector('#finish').addEventListener('click', async () => {
        document.querySelector('#finish').disabled = true;
        await fetch('/finish', { method: 'POST' }).catch(() => undefined);
      });
    </script>
  </body>
</html>`;
}

export async function startMosaicViewer(sessions, duration) {
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const page = mosaicViewerHtml(sessions, duration);
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      });
      response.end(page);
      return;
    }
    if (request.method === 'POST' && request.url === '/finish') {
      response.writeHead(204);
      response.end();
      finish('viewer');
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the local mosaic viewer.');

  return {
    url: `http://127.0.0.1:${address.port}/`,
    finished,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function stopSignal() {
  let stop;
  let stopped = false;
  const promise = new Promise((resolve) => { stop = resolve; });
  const interrupt = () => {
    stopped = true;
    stop('interrupt');
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  return {
    promise,
    get stopped() { return stopped; },
    dispose() {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    },
  };
}

function waitForDemo(seconds, signals) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timer'), seconds * 1000);
  });
  return Promise.race([timeout, ...signals]).finally(() => clearTimeout(timer));
}

async function releaseSessions(sessions) {
  if (sessions.length === 0) return;
  console.log('\nReleasing eight-device mosaic sessions...');
  const results = await Promise.allSettled(
    sessions.map((session) => runCloud(['ios', 'delete', session.id, '--json'])),
  );
  results.forEach((result, index) => {
    const session = sessions[index];
    if (result.status === 'fulfilled') console.log(`  released ${session.id}`);
    else console.error(`  failed to release ${session.id}: ${result.reason.message}`);
  });
}

function tileUrl(origin, tile) {
  let url;
  try {
    url = new URL('/demos/eight-device-mosaic/', origin);
  } catch {
    throw new Error('RUN_CLOUD_DEMO_ORIGIN must be a valid absolute URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RUN_CLOUD_DEMO_ORIGIN must use HTTP or HTTPS.');
  }
  url.searchParams.set('tile', String(tile));
  return url.toString();
}

export async function runDemo(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('Usage: npm run demo -- [--duration seconds] [--open]');
    return;
  }

  const origin = process.env.RUN_CLOUD_DEMO_ORIGIN || 'https://run.cloud';
  const sessions = [];
  const stop = stopSignal();
  let viewer;

  try {
    console.log('Starting eight iOS simulator sessions for the mosaic...');
    const starts = await Promise.allSettled(
      Array.from({ length: DEVICE_COUNT }, async (_, index) => {
        const session = await runCloud([
          'ios',
          'create',
          '--display-name',
          `mosaic-${String(index + 1).padStart(2, '0')}`,
          '--label',
          'demo=eight-device-mosaic',
          '--label',
          `tile=${index}`,
          '--hard-timeout',
          '10m',
          '--json',
        ]);
        sessions[index] = session;
        await runCloud([
          'ios',
          'open-url',
          tileUrl(origin, index),
          '--id',
          session.id,
          '--json',
        ]);
        return session;
      }),
    );

    const failures = starts
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.status === 'rejected');
    failures.forEach(({ result, index }) => {
      console.error(`  tile ${index + 1} failed: ${result.reason.message}`);
    });
    if (failures.length > 0 || stop.stopped) {
      throw new Error(failures.length > 0
        ? `The mosaic requires all ${DEVICE_COUNT} devices; ${failures.length} did not start.`
        : 'The mosaic was interrupted during setup.');
    }

    viewer = await startMosaicViewer(sessions, options.duration);
    console.log(`\nEight-device mosaic: ${viewer.url}`);
    if (options.open) openBrowser(viewer.url);
    console.log(`Keeping the mosaic live for ${options.duration} seconds. Press Ctrl+C to finish early.`);
    await waitForDemo(options.duration, [stop.promise, viewer.finished]);
  } finally {
    stop.dispose();
    if (viewer) await viewer.close();
    await releaseSessions(sessions.filter(Boolean));
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runDemo().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
