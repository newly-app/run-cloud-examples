import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { Client } from '@run-cloud/sdk';
import {
  assertBenchmarkTree,
  findBenchmarkNode,
  isVisiblePoint,
  normalizedCenter,
  requireBenchmarkNode,
} from './contract.mjs';

const READY_TIMEOUT_MS = 180_000;
const TREE_RETRY_ATTEMPTS = 16;
const TREE_RETRY_DELAY_MS = 350;
const benchmarkRun = safeRunId(requiredEnvironment('RUN_CLOUD_BENCHMARK_RUN_ID'));
const artifactDirectory = resolve(requiredEnvironment('RUN_CLOUD_BENCHMARK_ARTIFACT_DIR'));
const appPaths = {
  ios: resolve(requiredEnvironment('RUN_CLOUD_BENCHMARK_IOS_APP')),
  android: resolve(requiredEnvironment('RUN_CLOUD_BENCHMARK_ANDROID_APP')),
};
const fixtures = {
  ios: {
    filename: 'RunCloudProof.app.tar.gz',
    contentType: 'application/gzip',
  },
  android: {
    filename: 'RunCloudProof.apk',
    contentType: 'application/vnd.android.package-archive',
  },
};

await mkdir(artifactDirectory, { recursive: true });

test('published SDK authenticates the benchmark account', async () => {
  const cloud = new Client();
  const account = await cloud.account();
  assert.equal(account.runCloud, true, 'the benchmark account does not have run.cloud access');
});

for (const platform of ['ios', 'android']) {
  test(
    `${platform} returns and updates the documented native accessibility hierarchy`,
    { timeout: 12 * 60_000, concurrency: false },
    async (context) => {
      await runPlatformBenchmark(platform, context.signal);
    },
  );
}

async function runPlatformBenchmark(platform, signal) {
  const cloud = new Client();
  const simulator = cloud[platform];
  const fixture = fixtures[platform];
  let asset;
  let session;
  let operationError;
  const cleanup = {
    schemaVersion: 1,
    platform,
    benchmarkRun,
    session: 'not-created',
    asset: 'not-created',
  };

  try {
    throwIfAborted(signal);
    const app = await readFile(appPaths[platform]);
    asset = await cloud.assets.upload(new Blob([app], { type: fixture.contentType }), {
      name: `accessibility-benchmark-${benchmarkRun}-${platform}`,
      filename: fixture.filename,
      uploadBatchId: `accessibility-${benchmarkRun}-${platform}`,
      uploadRunId: benchmarkRun,
    });
    cleanup.asset = 'uploaded';

    session = await simulator.create({
      displayName: `accessibility-benchmark-${benchmarkRun}-${platform}`,
      tags: {
        suite: 'accessibility-benchmark',
        benchmarkRun,
        platform,
      },
      installAssets: [asset.id],
      inactivityTimeout: '3m',
      hardTimeout: '10m',
    });
    cleanup.session = 'created';
    session = await waitUntilActive(simulator, session, signal);
    console.log(`${platform} benchmark session active: ${session.id}`);

    const initialTree = await revealBenchmark(simulator, platform, session.id, signal);
    const initial = assertBenchmarkTree(initialTree, platform, 'initial');
    await writeJson(`${platform}-tree-initial.json`, initialTree);
    await writeScreenshot(simulator, platform, session.id, `${platform}-initial.png`, signal);

    await simulator.tap(session.id, normalizedCenter(initialTree, initial.toggle), {
      requestId: `benchmark:${benchmarkRun}:${platform}:notifications`,
      timeoutMs: 20_000,
      signal,
    });
    const notificationsTree = await waitForTreeState(
      simulator,
      platform,
      session.id,
      'notificationsOn',
      signal,
    );
    const notifications = assertBenchmarkTree(notificationsTree, platform, 'notificationsOn');
    assert.equal(notifications.toggle.states.checked, true);
    await writeJson(`${platform}-tree-notifications-on.json`, notificationsTree);

    await simulator.tap(session.id, normalizedCenter(notificationsTree, notifications.navigate), {
      requestId: `benchmark:${benchmarkRun}:${platform}:details`,
      timeoutMs: 20_000,
      signal,
    });
    const detailsTree = await waitForTreeState(
      simulator,
      platform,
      session.id,
      'details',
      signal,
    );
    const details = assertBenchmarkTree(detailsTree, platform, 'details');
    assert.equal(details.nestedLabel.label, 'Nested label: details');
    assert.equal(details.navigate.label, 'Back to overview');
    await writeJson(`${platform}-tree-details.json`, detailsTree);
    await writeScreenshot(simulator, platform, session.id, `${platform}-details.png`, signal);
    await writeJson(`${platform}-result.json`, {
      schemaVersion: 1,
      platform,
      benchmarkRun,
      sessionId: session.id,
      assetId: asset.id,
      screen: detailsTree.screen,
      nodeCount: detailsTree.nodeCount,
      states: ['initial', 'notificationsOn', 'details'],
      outcome: 'passed',
    });
  } catch (error) {
    operationError = asError(error);
    await writeJson(`${platform}-failure.json`, {
      schemaVersion: 1,
      platform,
      benchmarkRun,
      failure: sanitizedFailure(operationError),
    });
  }

  const cleanupErrors = [];
  if (session) {
    try {
      await simulator.delete(session.id);
      cleanup.session = 'released';
    } catch (error) {
      cleanup.session = 'release-failed';
      cleanupErrors.push(asError(error));
    }
  }
  if (asset) {
    try {
      await cloud.assets.delete(asset.id);
      cleanup.asset = 'deleted';
    } catch (error) {
      cleanup.asset = 'delete-failed';
      cleanupErrors.push(asError(error));
    }
  }
  await writeJson(`${platform}-cleanup.json`, cleanup);
  console.log(`${platform} benchmark cleanup: session=${cleanup.session}; asset=${cleanup.asset}`);

  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      `${platform} benchmark failed and cleanup did not complete`,
      { cause: operationError },
    );
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `${platform} benchmark cleanup did not complete`);
  }
}

async function waitUntilActive(simulator, initialSession, signal) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let session = initialSession;
  while (session.status !== 'active') {
    throwIfAborted(signal);
    if (session.status === 'failed' || session.status === 'released') {
      throw new Error(`session ${session.id} became ${session.status} before the app was ready`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`session ${session.id} was not active within ${READY_TIMEOUT_MS} ms`);
    }
    await wait(1_000, signal);
    session = await simulator.get(session.id);
  }
  return session;
}

async function revealBenchmark(simulator, platform, sessionId, signal) {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const tree = await simulator.accessibilityTree(sessionId, { timeoutMs: 20_000, signal });
    const toggle = findBenchmarkNode(tree, platform, 'toggle');
    if (toggle?.bounds && isVisiblePoint(normalizedCenter(tree, toggle))) return tree;
    await simulator.swipe(
      sessionId,
      { x: 0.08, y: 0.88 },
      { x: 0.08, y: 0.18 },
      { durationMs: 450, timeoutMs: 20_000, signal },
    );
    await wait(TREE_RETRY_DELAY_MS, signal);
  }
  throw new Error(`${platform} accessibility benchmark did not become visible`);
}

async function waitForTreeState(simulator, platform, sessionId, stateName, signal) {
  let lastTree;
  for (let attempt = 0; attempt < TREE_RETRY_ATTEMPTS; attempt += 1) {
    lastTree = await simulator.accessibilityTree(sessionId, { timeoutMs: 20_000, signal });
    const toggle = findBenchmarkNode(lastTree, platform, 'toggle');
    const nested = findBenchmarkNode(lastTree, platform, 'nestedLabel');
    const navigate = findBenchmarkNode(lastTree, platform, 'navigate');
    if (
      stateName === 'notificationsOn'
      && toggle?.states.checked === true
      && navigate?.label === 'Open details'
    ) return lastTree;
    if (
      stateName === 'details'
      && toggle?.states.checked === true
      && nested?.label === 'Nested label: details'
      && navigate?.label === 'Back to overview'
    ) return lastTree;
    await wait(TREE_RETRY_DELAY_MS, signal);
  }
  const lastStatus = lastTree
    ? requireBenchmarkNode(lastTree, platform, 'status').label
    : 'tree unavailable';
  throw new Error(`${platform} did not reach ${stateName}; last status: ${lastStatus}`);
}

async function writeScreenshot(simulator, platform, sessionId, filename, signal) {
  const bytes = Buffer.from(await simulator.screenshot(sessionId, {
    requestId: `benchmark:${benchmarkRun}:${platform}:screenshot:${filename}`,
    timeoutMs: 20_000,
    signal,
  }));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.byteLength > 1_000, `${platform} screenshot was unexpectedly small`);
  await writeFile(resolve(artifactDirectory, filename), bytes);
}

async function writeJson(filename, value) {
  await writeFile(
    resolve(artifactDirectory, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live accessibility benchmark`);
  return value;
}

function safeRunId(value) {
  const result = value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  if (!result) throw new Error('RUN_CLOUD_BENCHMARK_RUN_ID has no usable characters');
  return result;
}

function sanitizedFailure(error) {
  return {
    name: error.name,
    message: error.message
      .replace(/(?:https?|wss):\/\/\S+/gi, '[redacted URL]')
      .replace(/rc_(?:live|test)_[A-Za-z0-9._-]+/g, '[redacted API key]')
      .slice(0, 2_000),
  };
}

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

async function wait(milliseconds, signal) {
  await delay(milliseconds, undefined, signal ? { signal } : undefined);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw asError(signal.reason ?? 'benchmark cancelled');
}
