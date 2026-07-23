import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  appRoleUrl,
  cameraConfig,
  cameraViewerHtml,
  parseOptions,
  startCameraViewer,
} from './demo.mjs';

function sessions() {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `camera-${index + 1}`,
    url: `https://sim.example/session?token=secret-${index + 1}&device=device-${index + 1}`,
    baseUrl: 'https://sim.example',
    device: `device-${index + 1}`,
  }));
}

test('defaults to a three-device two-minute camera relay', () => {
  assert.deepEqual(parseOptions([]), { duration: 120, open: false });
});

test('accepts a shorter auto-open demo and rejects unsupported counts', () => {
  assert.deepEqual(parseOptions(['--duration', '30', '--open']), {
    duration: 30,
    open: true,
  });
  assert.throws(() => parseOptions(['--count', '4']), /Unknown option/);
});

test('builds role URLs with one private room', () => {
  const source = new URL(appRoleUrl('https://demo.example/live/', 'room-12345678', 'broadcaster'));
  const receiver = new URL(appRoleUrl('https://demo.example/live/', 'room-12345678', 'receiver', 2));
  assert.equal(source.searchParams.get('role'), 'broadcaster');
  assert.equal(receiver.searchParams.get('role'), 'receiver');
  assert.equal(receiver.searchParams.get('receiver'), '2');
  assert.equal(source.searchParams.get('room'), receiver.searchParams.get('room'));
});

test('extracts scoped camera credentials without accepting incomplete sessions', () => {
  assert.deepEqual(cameraConfig(sessions()[0]), {
    baseUrl: 'https://sim.example',
    token: 'secret-1',
    device: 'device-1',
  });
  assert.throws(
    () => cameraConfig({ url: 'https://sim.example/?device=device-1' }),
    /does not contain a camera token/,
  );
});

test('renders three signed embeds while keeping credentials out of the local URL', async () => {
  const demoSessions = sessions();
  const html = cameraViewerHtml(demoSessions, 60, 'room-12345678', 1_000);
  assert.equal((html.match(/<iframe /g) || []).length, 3);
  assert.match(html, /embed=1/);
  assert.doesNotMatch(html, /loadingGuard=1/);
  assert.match(html, /Connect webcam/);
  assert.match(html, /com\.apple\.mobilesafari/);
  assert.match(html, /audio: false/);
  assert.match(html, /const deadline = 61000/);

  const viewer = await startCameraViewer(demoSessions, 60, 'room-12345678');
  try {
    assert.doesNotMatch(viewer.url, /secret/);
    const response = await fetch(viewer.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const finish = await fetch(new URL('/finish', viewer.url), { method: 'POST' });
    assert.equal(finish.status, 204);
    assert.equal(await viewer.finished, 'viewer');
  } finally {
    await viewer.close();
  }
});

test('starts, assigns, and releases the broadcaster and two receivers', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-cloud-camera-demo-'));
  const fakeCli = join(root, 'runcloud');
  const operationLog = join(root, 'operations.jsonl');
  writeFileSync(
    fakeCli,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.RUN_CLOUD_DEMO_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'ios' && args[1] === 'create') {
  const name = args[args.indexOf('--display-name') + 1];
  process.stdout.write(JSON.stringify({
    id: name,
    url: 'https://sim.example/session?token=secret&device=' + name,
    baseUrl: 'https://sim.example',
    device: name,
  }));
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
}
`,
  );
  chmodSync(fakeCli, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      ['demo.mjs', '--duration', '1'],
      {
        cwd: dirname(fileURLToPath(import.meta.url)),
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNCLOUD_BIN: fakeCli,
          RUN_CLOUD_DEMO_LOG: operationLog,
          RUN_CLOUD_CAMERA_DEMO_URL: 'https://preview.example/live-camera-relay/',
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /token=secret/);
    const operations = readFileSync(operationLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const creates = operations.filter((args) => args[1] === 'create');
    const opens = operations.filter((args) => args[1] === 'open-url');
    const deletes = operations.filter((args) => args[1] === 'delete');
    assert.equal(creates.length, 3);
    assert.equal(opens.length, 3);
    assert.equal(deletes.length, 3);
    assert.deepEqual(opens.map((args) => new URL(args[2]).searchParams.get('role')).sort(), [
      'broadcaster',
      'receiver',
      'receiver',
    ]);
    assert.equal(new Set(opens.map((args) => new URL(args[2]).searchParams.get('room'))).size, 1);
    assert.ok(opens.every((args) => new URL(args[2]).origin === 'https://preview.example'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
