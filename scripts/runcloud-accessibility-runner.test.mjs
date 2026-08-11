import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  benchmarkRunId,
  runnerName,
  sandboxCommand,
  sanitizeFailure,
  sweepMobileResources,
} from './runcloud-accessibility-runner.mjs';

test('runner and benchmark identities are deterministic per Actions attempt', () => {
  const env = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' };
  assert.equal(runnerName(env), 'accessibility-benchmark-123-2');
  assert.equal(benchmarkRunId(env), 'gha-123-2');
});

test('sandbox command runs the published-SDK suite and preserves a TAP artifact', () => {
  const command = sandboxCommand();
  assert.match(command, /npm ci --ignore-scripts/);
  assert.match(command, /npm ls @run-cloud\/sdk/);
  assert.match(command, /npm run test:live/);
  assert.match(command, /test-report\.tap/);
  assert.match(command, /run-cloud-accessibility-results\.tar\.gz/);
  assert.doesNotMatch(command, /RUN_CLOUD_API_KEY=/);
});

test('failure summaries redact credentials and signed URLs', () => {
  const sanitized = sanitizeFailure(
    'Authorization: Bearer rc_live_secret https://viewer.run.cloud/signed?token=secret',
  );
  assert.equal(sanitized.includes('rc_live_secret'), false);
  assert.equal(sanitized.includes('token=secret'), false);
  assert.match(sanitized, /\[redacted/);
});

test('run-scoped cleanup releases only matching mobile sessions and assets', async () => {
  const calls = [];
  const client = {
    ios: {
      list: async () => [
        {
          id: 'ios-owned',
          status: 'active',
          tags: { suite: 'accessibility-benchmark', benchmarkRun: 'gha-123-2' },
        },
        {
          id: 'ios-other',
          status: 'active',
          tags: { suite: 'accessibility-benchmark', benchmarkRun: 'gha-other' },
        },
      ],
      delete: async (id) => calls.push(['ios', id]),
    },
    android: {
      list: async () => [{
        id: 'android-released',
        status: 'released',
        tags: { suite: 'accessibility-benchmark', benchmarkRun: 'gha-123-2' },
      }],
      delete: async (id) => calls.push(['android', id]),
    },
    assets: {
      list: async () => [
        { id: 'asset-owned', name: 'accessibility-benchmark-gha-123-2-ios' },
        { id: 'asset-other', name: 'accessibility-benchmark-gha-other-ios' },
      ],
      delete: async (id) => calls.push(['asset', id]),
    },
  };

  const result = await sweepMobileResources(client, 'gha-123-2');
  assert.deepEqual(calls, [
    ['ios', 'ios-owned'],
    ['asset', 'asset-owned'],
  ]);
  assert.deepEqual(result.ios, [{ id: 'ios-owned', result: 'released' }]);
  assert.deepEqual(result.android, [{ id: 'android-released', result: 'already-released' }]);
  assert.deepEqual(result.assets, [{ id: 'asset-owned', result: 'deleted' }]);
  assert.deepEqual(result.errors, []);
});

test('the repository workflow keeps runner identity, artifacts, and always cleanup visible', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/test.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /@run-cloud\/sdk@0\.22\.0/);
  assert.match(workflow, /runcloud-accessibility-runner\.mjs/);
  assert.match(workflow, /name: Confirm run\.cloud cleanup[\s\S]*if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /name: Upload accessibility benchmark evidence[\s\S]*if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /runcloud-accessibility-results/);
});
