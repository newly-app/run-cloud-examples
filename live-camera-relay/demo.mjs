import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const DEVICE_COUNT = 3;
const DEFAULT_APP_URL = 'https://newly-app.github.io/run-cloud-examples/live-camera-relay/';

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

function scriptData(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function embedUrl(value) {
  const url = new URL(value);
  url.searchParams.set('loadingGuard', '1');
  return url.toString();
}

function absoluteHttpUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url;
}

export function cameraConfig(session) {
  const signedUrl = absoluteHttpUrl(session.url, 'The signed simulator URL');
  const baseUrl = absoluteHttpUrl(session.baseUrl || signedUrl.origin, 'The simulator base URL');
  const token = signedUrl.searchParams.get('token');
  const device = session.device || signedUrl.searchParams.get('device');
  if (!token) throw new Error('The broadcaster session URL does not contain a camera token.');
  if (!device) throw new Error('The broadcaster session does not identify its simulator device.');
  return { baseUrl: baseUrl.toString().replace(/\/$/, ''), token, device };
}

export function appRoleUrl(appUrl, roomId, role, receiver) {
  const url = absoluteHttpUrl(appUrl, 'RUN_CLOUD_CAMERA_DEMO_URL');
  url.searchParams.set('room', roomId);
  url.searchParams.set('role', role);
  if (receiver) url.searchParams.set('receiver', String(receiver));
  return url.toString();
}

export function cameraViewerHtml(sessions, duration, roomId, now = Date.now()) {
  if (sessions.length !== DEVICE_COUNT) throw new Error('The camera viewer requires three sessions.');
  const source = cameraConfig(sessions[0]);
  const roles = ['Broadcaster', 'Receiver 01', 'Receiver 02'];
  const frames = sessions.map((session, index) => `
        <section class="device" data-device="${index}">
          <div class="device-heading"><span>${roles[index]}</span><b data-state>CONNECTING</b></div>
          <iframe title="${roles[index]} simulator" src="${escapeHtml(embedUrl(session.url))}" allow="clipboard-read; clipboard-write"></iframe>
        </section>`).join('');
  const deadline = now + duration * 1000;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>run.cloud live camera relay</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #030404; color: #f8fafc; }
      * { box-sizing: border-box; }
      html, body { width: 100%; min-height: 100%; margin: 0; }
      body { display: grid; grid-template-rows: 64px minmax(0, 1fr); min-height: 100vh; background: #030404; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid rgba(255,255,255,.12); padding: 0 18px; background: #070909; }
      .brand, .camera-controls, .session-status { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .brand-mark { width: 22px; height: 14px; border: 2px solid #67e8f9; transform: skewX(-18deg); }
      .brand strong { font-size: 14px; font-weight: 700; }
      .brand span, .session-status { color: #94a3b8; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
      .session-status b { color: #bef264; font-weight: 600; }
      #timer { width: 42px; color: #e2e8f0; text-align: right; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
      #local-preview { display: none; width: 72px; height: 42px; border: 1px solid #334155; background: #020303; object-fit: cover; }
      #local-preview.active { display: block; }
      button { height: 36px; border-radius: 4px; padding: 0 13px; cursor: pointer; font: 600 12px ui-sans-serif, system-ui, sans-serif; }
      #connect-camera { border: 0; background: #f8fafc; color: #020617; }
      #connect-camera:hover { background: #dbeafe; }
      #connect-camera[data-live="true"] { background: #bef264; }
      #finish { width: 36px; border: 1px solid rgba(255,255,255,.18); padding: 0; background: transparent; color: #f8fafc; font-size: 18px; }
      button:disabled { cursor: wait; opacity: .55; }
      main { min-height: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 8px; }
      .device { min-width: 0; min-height: 0; display: grid; grid-template-rows: 34px minmax(0, 1fr); border: 1px solid #1e293b; background: #080b0b; }
      .device-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid #1e293b; padding: 0 10px; color: #cbd5e1; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
      .device-heading b { color: #64748b; font-weight: 600; }
      .device[data-ready="true"] .device-heading b { color: #bef264; }
      .device[data-ended="true"] .device-heading b { color: #fda4af; }
      iframe { display: block; width: 100%; height: 100%; min-height: 540px; border: 0; }
      #message { position: fixed; right: 12px; bottom: 12px; z-index: 5; max-width: min(440px, calc(100vw - 24px)); border: 1px solid #7f1d1d; background: #2b0b0d; color: #fecdd3; padding: 10px 12px; font-size: 12px; line-height: 18px; }
      #message:empty { display: none; }
      @media (max-width: 920px) {
        body { display: block; }
        header { position: sticky; top: 0; z-index: 4; height: auto; min-height: 64px; flex-wrap: wrap; padding: 10px; }
        .brand span, .session-status span { display: none; }
        main { grid-template-columns: 1fr; }
        .device { min-height: 680px; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="brand"><i class="brand-mark"></i><strong>run.cloud</strong><span>LIVE CAMERA RELAY</span></div>
      <div class="session-status"><b id="ready-count">0/${DEVICE_COUNT} LIVE</b><span>ROOM ${escapeHtml(roomId)}</span><span id="timer">--:--</span></div>
      <div class="camera-controls">
        <video id="local-preview" muted playsinline aria-label="Local webcam preview"></video>
        <button id="connect-camera" type="button">Connect webcam</button>
        <button id="finish" type="button" title="End demo" aria-label="End demo">×</button>
      </div>
    </header>
    <main>${frames}</main>
    <div id="message" role="alert"></div>
    <script>
      const camera = ${scriptData(source)};
      const deadline = ${deadline};
      const devices = [...document.querySelectorAll('.device')];
      const frames = [...document.querySelectorAll('iframe')];
      const ready = new Set();
      const count = document.querySelector('#ready-count');
      const timer = document.querySelector('#timer');
      const connectButton = document.querySelector('#connect-camera');
      const preview = document.querySelector('#local-preview');
      const message = document.querySelector('#message');
      let webcamStream = null;
      let frameTimer = null;
      let stopped = false;

      const integrationUrl = (path) => {
        const url = new URL('/api/integration/camera/' + path, camera.baseUrl);
        url.searchParams.set('device', camera.device);
        return url;
      };
      const postCamera = async (path, body) => {
        const response = await fetch(integrationUrl(path), {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + camera.token,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Camera request failed with HTTP ' + response.status);
        }
      };
      const stopWebcam = async () => {
        stopped = true;
        if (frameTimer) clearTimeout(frameTimer);
        webcamStream?.getTracks().forEach((track) => track.stop());
        webcamStream = null;
        preview.srcObject = null;
        await postCamera('stop').catch(() => undefined);
      };
      const connectWebcam = async () => {
        connectButton.disabled = true;
        message.textContent = '';
        stopped = false;
        try {
          await postCamera('attach', {
            bundleId: 'com.apple.mobilesafari',
            mirror: 'on',
            source: { type: 'client' },
          });
          webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          preview.srcObject = webcamStream;
          await preview.play();
          preview.classList.add('active');
          connectButton.dataset.live = 'true';
          connectButton.textContent = 'Webcam connected';

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas rendering is unavailable.');
          const sendFrame = async () => {
            if (stopped || !webcamStream) return;
            try {
              const sourceWidth = preview.videoWidth || 640;
              const sourceHeight = preview.videoHeight || 480;
              const width = Math.min(640, sourceWidth);
              const height = Math.max(1, Math.round(sourceHeight * width / sourceWidth));
              if (canvas.width !== width) canvas.width = width;
              if (canvas.height !== height) canvas.height = height;
              context.drawImage(preview, 0, 0, width, height);
              await postCamera('client-frame', { dataUrl: canvas.toDataURL('image/jpeg', 0.68) });
              if (!stopped) frameTimer = setTimeout(sendFrame, 125);
            } catch (error) {
              message.textContent = error instanceof Error ? error.message : String(error);
              await stopWebcam();
              connectButton.dataset.live = 'false';
              connectButton.textContent = 'Reconnect webcam';
              connectButton.disabled = false;
            }
          };
          frameTimer = setTimeout(sendFrame, 0);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : String(error);
          await stopWebcam();
          connectButton.textContent = 'Retry webcam';
          connectButton.disabled = false;
        }
      };

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
          devices[index].dataset.ready = 'true';
          devices[index].querySelector('[data-state]').textContent = 'LIVE';
          count.textContent = ready.size + '/${DEVICE_COUNT} LIVE';
        }
        if (event.data.type === 'ios-simulator:session-ended') {
          devices[index].dataset.ended = 'true';
          devices[index].querySelector('[data-state]').textContent = 'ENDED';
        }
      });
      connectButton.addEventListener('click', connectWebcam);
      document.querySelector('#finish').addEventListener('click', async () => {
        document.querySelector('#finish').disabled = true;
        await stopWebcam();
        await fetch('/finish', { method: 'POST' }).catch(() => undefined);
      });
      window.addEventListener('pagehide', () => {
        webcamStream?.getTracks().forEach((track) => track.stop());
      });
    </script>
  </body>
</html>`;
}

export async function startCameraViewer(sessions, duration, roomId) {
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const page = cameraViewerHtml(sessions, duration, roomId);
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
  if (!address || typeof address === 'string') throw new Error('Could not start the local camera viewer.');

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
  console.log('\nReleasing live camera relay sessions...');
  const results = await Promise.allSettled(
    sessions.map((session) => runCloud(['ios', 'delete', session.id, '--json'])),
  );
  results.forEach((result, index) => {
    const session = sessions[index];
    if (result.status === 'fulfilled') console.log(`  released ${session.id}`);
    else console.error(`  failed to release ${session.id}: ${result.reason.message}`);
  });
}

export async function runDemo(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('Usage: npm run demo -- [--duration seconds] [--open]');
    return;
  }

  const appUrl = process.env.RUN_CLOUD_CAMERA_DEMO_URL || DEFAULT_APP_URL;
  const roomId = randomBytes(12).toString('hex');
  const assignments = [
    { name: 'camera-broadcaster', role: 'broadcaster', receiver: undefined },
    { name: 'camera-receiver-01', role: 'receiver', receiver: 1 },
    { name: 'camera-receiver-02', role: 'receiver', receiver: 2 },
  ];
  const sessions = [];
  const stop = stopSignal();
  let viewer;

  try {
    console.log('Starting one broadcaster and two receiver simulators...');
    const starts = await Promise.allSettled(assignments.map(async (assignment, index) => {
      const session = await runCloud([
        'ios',
        'create',
        '--display-name',
        assignment.name,
        '--label',
        'demo=live-camera-relay',
        '--label',
        `role=${assignment.role}`,
        '--hard-timeout',
        '10m',
        '--json',
      ]);
      sessions[index] = session;
      await runCloud([
        'ios',
        'open-url',
        appRoleUrl(appUrl, roomId, assignment.role, assignment.receiver),
        '--id',
        session.id,
        '--json',
      ]);
      return session;
    }));

    const failures = starts
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.status === 'rejected');
    failures.forEach(({ result, index }) => {
      console.error(`  ${assignments[index].name} failed: ${result.reason.message}`);
    });
    if (failures.length > 0 || stop.stopped) {
      throw new Error(failures.length > 0
        ? `The camera relay requires all ${DEVICE_COUNT} devices; ${failures.length} did not start.`
        : 'The camera relay was interrupted during setup.');
    }

    viewer = await startCameraViewer(sessions, options.duration, roomId);
    console.log(`\nLive camera relay: ${viewer.url}`);
    if (options.open) openBrowser(viewer.url);
    console.log('Connect the webcam, then start the camera inside the broadcaster simulator.');
    console.log(`Keeping the demo live for ${options.duration} seconds. Press Ctrl+C to finish early.`);
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
