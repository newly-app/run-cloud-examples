import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mosaicViewerHtml, parseOptions, startMosaicViewer } from './demo.mjs';

test('defaults to an eight-device two-minute mosaic', () => {
  assert.deepEqual(parseOptions([]), { duration: 120, open: false });
});

test('accepts a shorter auto-open demo and rejects unsupported counts', () => {
  assert.deepEqual(parseOptions(['--duration', '30', '--open']), {
    duration: 30,
    open: true,
  });
  assert.throws(() => parseOptions(['--count', '4']), /Unknown option/);
});

test('renders eight signed embeds without printing them into the viewer URL', async () => {
  const sessions = Array.from({ length: 8 }, (_, index) => ({
    id: `mosaic-${index + 1}`,
    url: `https://sim.example/session-${index + 1}?token=secret-${index + 1}`,
  }));
  const html = mosaicViewerHtml(sessions, 60, 1_000);
  assert.equal((html.match(/<iframe /g) || []).length, 8);
  assert.match(html, /embed=1/);
  assert.match(html, /loadingGuard=1/);
  assert.match(html, /const deadline = 61000/);

  const viewer = await startMosaicViewer(sessions, 60);
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

test('starts, tiles, and releases all eight simulators', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-cloud-mosaic-demo-'));
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
  process.stdout.write(JSON.stringify({ id: name, url: 'https://sim.example/' + name + '?token=secret' }));
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
          RUN_CLOUD_DEMO_ORIGIN: 'https://preview.run.cloud',
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
    assert.equal(creates.length, 8);
    assert.equal(opens.length, 8);
    assert.equal(deletes.length, 8);
    assert.deepEqual(
      opens.map((args) => new URL(args[2]).searchParams.get('tile')).sort(),
      ['0', '1', '2', '3', '4', '5', '6', '7'],
    );
    assert.ok(opens.every((args) => new URL(args[2]).origin === 'https://preview.run.cloud'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
