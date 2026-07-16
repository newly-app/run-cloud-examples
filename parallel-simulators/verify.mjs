import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOptions } from './demo.mjs';

test('defaults to three two-minute sessions', () => {
  assert.deepEqual(parseOptions([]), { count: 3, duration: 120, open: false });
});

test('accepts a two-session short demo', () => {
  assert.deepEqual(parseOptions(['--count', '2', '--duration', '30', '--open']), {
    count: 2,
    duration: 30,
    open: true,
  });
});

test('keeps the demo within the supported parallel range', () => {
  assert.throws(() => parseOptions(['--count', '20']), /must be 2 or 3/);
});

test('starts, opens, and releases every simulator', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-cloud-parallel-demo-'));
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
  process.stdout.write(JSON.stringify({ id: name, url: 'https://sim.example/' + name }));
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
}
`,
  );
  chmodSync(fakeCli, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      ['demo.mjs', '--count', '2', '--duration', '1'],
      {
        cwd: dirname(fileURLToPath(import.meta.url)),
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNCLOUD_BIN: fakeCli,
          RUN_CLOUD_DEMO_LOG: operationLog,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const operations = readFileSync(operationLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(operations.filter((args) => args[1] === 'create').length, 2);
    assert.equal(operations.filter((args) => args[1] === 'open-url').length, 2);
    assert.equal(operations.filter((args) => args[1] === 'delete').length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
