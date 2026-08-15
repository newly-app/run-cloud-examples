import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { generateFixtures } from './generate-fixtures.mjs';
import {
  assertMediaPass,
  fingerprints,
  mediaStatus,
  normalizedCenter,
  permissionButton,
} from './proof-contract.mjs';

const SESSION_READY_TIMEOUT_MS = 180_000;
const APP_READY_TIMEOUT_MS = 90_000;
const APP_PASS_TIMEOUT_MS = 90_000;
const POLL_DELAY_MS = 750;
const BUNDLE_ID = 'cloud.run.examples.screenshot';
const platform = oneOfEnvironment('RUN_CLOUD_MEDIA_PLATFORM', ['ios', 'android']);
const input = oneOfEnvironment('RUN_CLOUD_MEDIA_INPUT', ['camera', 'microphone']);
const mediaRun = safeRunId(requiredEnvironment('RUN_CLOUD_MEDIA_RUN_ID'));
const appPath = resolve(requiredEnvironment('RUN_CLOUD_MEDIA_APP'));
const artifactDirectory = resolve(requiredEnvironment('RUN_CLOUD_MEDIA_ARTIFACT_DIR'));
const sdkEntrypoint = process.env.RUN_CLOUD_SDK_ENTRYPOINT?.trim() || '@run-cloud/sdk';
const cliEntrypoint = resolve(
  process.env.RUN_CLOUD_CLI_ENTRYPOINT?.trim()
    || resolve(import.meta.dirname, 'node_modules/runcloud/dist/run-cloud.js'),
);
const stagePath = resolve(artifactDirectory, 'stages.jsonl');

await mkdir(artifactDirectory, { recursive: true });
await writeFile(stagePath, '', 'utf8');

test(
  `${platform} ${input} injection reports the native fingerprint through the public SDK and CLI`,
  { timeout: 25 * 60_000 },
  async (context) => {
    await runMediaProof(context.signal);
  },
);

async function runMediaProof(signal) {
  const sdkModule = await stage('package-sdk-load', async () =>
    await import(moduleSpecifier(sdkEntrypoint)));
  assert.equal(typeof sdkModule.Client, 'function', 'SDK package omitted Client');
  await stage('package-cli-load', async () => access(cliEntrypoint));
  const sdkResolved = await resolveModuleEntrypoint(sdkEntrypoint);
  const packageEvidence = {
    sdk: await packageIdentity(sdkResolved, '@run-cloud/sdk'),
    cli: await packageIdentity(cliEntrypoint, 'runcloud'),
  };
  assert.equal(packageEvidence.sdk.name, '@run-cloud/sdk');
  assert.equal(packageEvidence.cli.name, 'runcloud');

  const cloud = new sdkModule.Client();
  const simulator = cloud[platform];
  await stage('package-public-contract', async () => {
    for (const method of ['uploadCameraVideo', 'uploadMicrophoneAudio']) {
      assert.equal(typeof simulator[method], 'function', `SDK omitted ${platform}.${method}`);
    }
    await invokeCli([platform, input, 'inject', '--help'], signal, false);
  });
  const sessions = [];
  const assetIds = new Set();
  const cleanup = [];
  let operationError;

  try {
    const account = await stage('authenticate', async () => await cloud.account());
    assert.ok(account.userId, 'authenticated account omitted userId');
    assert.ok(Array.isArray(account.orgs), 'authenticated account omitted orgs');

    const app = await stage('read-native-app', async () => await readFile(appPath));
    const fixtures = await stage('generate-synthetic-inputs', async () =>
      await generateFixtures(resolve(artifactDirectory, 'inputs')));
    const mediaPath = input === 'camera' ? fixtures.cameraPath : fixtures.microphonePath;
    const mediaBytes = await readFile(mediaPath);
    const mediaManifest = fixtures.manifest[input];
    assert.equal(mediaManifest.fingerprint, fingerprints[input]);

    await writeJson('runner.json', {
      schemaVersion: 1,
      platform,
      input,
      mediaRun,
      runner: {
        kind: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'local',
        name: process.env.RUNNER_NAME ?? null,
        os: process.env.RUNNER_OS ?? process.platform,
        arch: process.env.RUNNER_ARCH ?? process.arch,
        imageOs: process.env.ImageOS ?? null,
        imageVersion: process.env.ImageVersion ?? null,
      },
      github: {
        repository: process.env.GITHUB_REPOSITORY ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        job: process.env.GITHUB_JOB ?? null,
        sha: process.env.GITHUB_SHA ?? null,
      },
      packages: packageEvidence,
      nativeApp: {
        filename: appPath.split('/').at(-1),
        byteSize: app.byteLength,
        sha256: createHash('sha256').update(app).digest('hex'),
      },
      media: mediaManifest,
    });

    const appAsset = await stage('upload-native-app', async () =>
      await cloud.assets.upload(
        new Blob([app], { type: platform === 'ios'
          ? 'application/gzip'
          : 'application/vnd.android.package-archive' }),
        {
          name: `media-proof-${mediaRun}-${platform}-app`,
          filename: platform === 'ios' ? 'RunCloudProof.app.tar.gz' : 'RunCloudProof.apk',
          uploadBatchId: `media-proof-${mediaRun}-${platform}-${input}`,
          uploadRunId: mediaRun,
        },
      ));
    assetIds.add(appAsset.id);

    const surfaceResults = [];
    for (const surface of ['sdk', 'cli']) {
      throwIfAborted(signal);
      const attempt = safeRunId(`${surface}-${mediaRun}`).slice(0, 48);
      let session = await stage(`${surface}-session-create`, async () =>
        await simulator.create({
          displayName: `regression:${mediaRun}:${platform}:media-${input}-${surface}`,
          tags: {
            suite: 'native-media-injection',
            mediaRun,
            platform,
            input,
            surface,
            'regression.suite': 'simulator-infra',
            'regression.run': mediaRun,
            'regression.test': `media-${input}-${surface}`,
          },
          installAssets: [appAsset.id],
          inactivityTimeout: '3m',
          hardTimeout: '12m',
        }));
      sessions.push({ surface, simulator, session });
      session = await stage(`${surface}-session-ready`, async () =>
        await waitUntilActive(simulator, session, signal));
      sessions.at(-1).session = session;

      const deepLink = `runcloudproof://media/${input}?attempt=${encodeURIComponent(attempt)}`;
      await stage(`${surface}-app-open`, async () =>
        await simulator.openUrl(session.id, deepLink));
      const armed = await stage(`${surface}-app-arm`, async () =>
        await waitForAppReady(simulator, session.id, attempt, signal));
      await writeJson(`${surface}-tree-armed.json`, armed.tree);

      let acknowledgement;
      if (surface === 'sdk') {
        acknowledgement = await stage('sdk-media-inject', async () => {
          const blob = new Blob([mediaBytes], { type: mediaManifest.contentType });
          const options = {
            bundleId: BUNDLE_ID,
            filename: mediaManifest.filename,
            name: `media-proof-${mediaRun}-${platform}-${input}-sdk`,
          };
          return input === 'camera'
            ? await simulator.uploadCameraVideo(session.id, blob, options)
            : await simulator.uploadMicrophoneAudio(session.id, blob, options);
        });
      } else {
        acknowledgement = await stage('cli-media-inject', async () =>
          await invokeCli([
            platform,
            input,
            'inject',
            session.id,
            mediaPath,
            '--bundle-id',
            BUNDLE_ID,
            '--name',
            `media-proof-${mediaRun}-${platform}-${input}-cli`,
            '--json',
          ], signal));
      }
      validateAcknowledgement(acknowledgement, surface, session.id, mediaManifest);
      assetIds.add(acknowledgement.asset.id);
      await writeJson(`${surface}-injection-response.json`, acknowledgementEvidence(acknowledgement));

      const passed = await stage(`${surface}-app-fingerprint`, async () =>
        await waitForAppPass(simulator, session.id, input, attempt, signal));
      await writeJson(`${surface}-tree-pass.json`, passed.tree);
      await stage(`${surface}-screenshot`, async () =>
        await writeScreenshot(simulator, session.id, `${surface}-pass.png`, signal));
      const logs = await stage(`${surface}-logs`, async () =>
        await simulator.logs(session.id, { tail: 300 }));
      await writeJson(`${surface}-simulator-logs.json`, logs);
      surfaceResults.push({
        surface,
        attempt,
        sessionId: session.id,
        fingerprint: fingerprints[input],
        appStatus: passed.status,
        outcome: 'passed',
      });

      await stage(`${surface}-session-release`, async () => {
        await simulator.delete(session.id);
        cleanup.push({ resource: 'session', surface, id: session.id, outcome: 'released' });
        sessions.splice(sessions.findIndex((item) => item.session.id === session.id), 1);
      });
      await stage(`${surface}-media-asset-delete`, async () => {
        await cloud.assets.delete(acknowledgement.asset.id);
        cleanup.push({
          resource: 'asset',
          surface,
          id: acknowledgement.asset.id,
          outcome: 'deleted',
        });
        assetIds.delete(acknowledgement.asset.id);
      });
    }

    await writeJson('result.json', {
      schemaVersion: 1,
      platform,
      input,
      mediaRun,
      packages: packageEvidence,
      fingerprint: fingerprints[input],
      surfaces: surfaceResults,
      outcome: 'passed',
    });
  } catch (error) {
    operationError = asError(error);
    const diagnostics = await collectFailureEvidence(sessions, currentStage);
    await writeJson('failure-diagnostics.json', {
      schemaVersion: 1,
      platform,
      input,
      mediaRun,
      stage: currentStage,
      sessions: diagnostics,
    });
    await writeJson('failure.json', {
      schemaVersion: 1,
      platform,
      input,
      mediaRun,
      stage: currentStage,
      failure: sanitizedFailure(operationError),
      diagnostics: 'failure-diagnostics.json',
    });
  }

  for (const retained of [...sessions].reverse()) {
    try {
      await retained.simulator.delete(retained.session.id);
      cleanup.push({ resource: 'session', surface: retained.surface, id: retained.session.id, outcome: 'released' });
    } catch (error) {
      cleanup.push({
        resource: 'session',
        surface: retained.surface,
        id: retained.session.id,
        outcome: 'release-failed',
        failure: sanitizedFailure(asError(error)),
      });
    }
  }
  for (const assetId of assetIds) {
    try {
      await cloud.assets.delete(assetId);
      cleanup.push({ resource: 'asset', id: assetId, outcome: 'deleted' });
    } catch (error) {
      cleanup.push({
        resource: 'asset',
        id: assetId,
        outcome: 'delete-failed',
        failure: sanitizedFailure(asError(error)),
      });
    }
  }
  await writeJson('cleanup.json', {
    schemaVersion: 1,
    platform,
    input,
    mediaRun,
    resources: cleanup,
    outcome: cleanup.some((item) => item.outcome.endsWith('failed')) ? 'failed' : 'complete',
  });

  const cleanupFailed = cleanup.filter((item) => item.outcome.endsWith('failed'));
  if (operationError && cleanupFailed.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupFailed.map((item) => new Error(JSON.stringify(item)))],
      `${platform} ${input} proof failed and cleanup did not complete`,
      { cause: operationError },
    );
  }
  if (operationError) throw operationError;
  if (cleanupFailed.length > 0) {
    throw new Error(`${platform} ${input} proof passed but cleanup did not complete`);
  }
}

let currentStage = 'initialization';

async function stage(name, operation) {
  currentStage = name;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  await appendStage({ stage: name, status: 'started', startedAt });
  try {
    const value = await operation();
    await appendStage({
      stage: name,
      status: 'passed',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    });
    return value;
  } catch (error) {
    await appendStage({
      stage: name,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      failure: sanitizedFailure(asError(error)),
    });
    throw error;
  }
}

async function appendStage(value) {
  await appendFile(stagePath, `${JSON.stringify(value)}\n`, 'utf8');
  console.log(`[${value.status}] ${value.stage}`);
}

async function waitUntilActive(simulator, initialSession, signal) {
  const deadline = Date.now() + SESSION_READY_TIMEOUT_MS;
  let session = initialSession;
  while (session.status !== 'active') {
    throwIfAborted(signal);
    if (session.status === 'failed' || session.status === 'released') {
      throw new Error(`session ${session.id} became ${session.status} before app installation completed`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`session ${session.id} was not active within ${SESSION_READY_TIMEOUT_MS} ms`);
    }
    await wait(POLL_DELAY_MS, signal);
    session = await simulator.get(session.id);
  }
  return session;
}

async function waitForAppReady(simulator, sessionId, attempt, signal) {
  const deadline = Date.now() + APP_READY_TIMEOUT_MS;
  let lastStatus = null;
  let permissionTaps = 0;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const tree = await simulator.accessibilityTree(sessionId, { timeoutMs: 20_000, signal });
    lastStatus = mediaStatus(tree) ?? lastStatus;
    if (lastStatus?.includes(' FAIL ')) {
      throw new Error(`native app failed while arming ${input}: ${lastStatus}`);
    }
    if (lastStatus?.includes(`attempt=${attempt}`)) {
      if (lastStatus.includes(' READY ')) return { tree, status: lastStatus, permissionTaps };
      if (platform === 'ios' && / (?:ARMED|PERMISSION) /.test(lastStatus)) {
        return { tree, status: lastStatus, permissionTaps };
      }
    }
    const button = permissionButton(tree);
    if (button) {
      await simulator.tap(sessionId, normalizedCenter(tree, button), {
        requestId: `media:${mediaRun}:${platform}:${input}:${attempt}:permission:${permissionTaps}`,
        timeoutMs: 20_000,
        signal,
      });
      permissionTaps += 1;
    }
    await wait(POLL_DELAY_MS, signal);
  }
  throw new Error(
    `native app did not arm ${input} for attempt ${attempt}; last status: ${lastStatus ?? 'unavailable'}`,
  );
}

async function waitForAppPass(simulator, sessionId, expectedInput, attempt, signal) {
  const deadline = Date.now() + APP_PASS_TIMEOUT_MS;
  let lastTree;
  let lastStatus = null;
  let permissionTaps = 0;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    lastTree = await simulator.accessibilityTree(sessionId, { timeoutMs: 20_000, signal });
    lastStatus = mediaStatus(lastTree) ?? lastStatus;
    if (lastStatus?.includes(' FAIL ')) {
      throw new Error(`native app rejected injected ${expectedInput}: ${lastStatus}`);
    }
    if (lastStatus?.includes(`${expectedInput.toUpperCase()} PASS`)) {
      assertMediaPass(lastStatus, expectedInput, attempt);
      return { tree: lastTree, status: lastStatus };
    }
    const button = permissionButton(lastTree);
    if (button) {
      await simulator.tap(sessionId, normalizedCenter(lastTree, button), {
        requestId: `media:${mediaRun}:${platform}:${input}:${attempt}:post-injection-permission:${permissionTaps}`,
        timeoutMs: 20_000,
        signal,
      });
      permissionTaps += 1;
    }
    await wait(POLL_DELAY_MS, signal);
  }
  if (lastTree) await writeJson('last-tree-before-timeout.json', lastTree);
  throw new Error(
    `native app did not report ${fingerprints[expectedInput]} for attempt ${attempt}; `
      + `last status: ${lastStatus ?? 'unavailable'}`,
  );
}

async function invokeCli(args, signal, parseJson = true) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliEntrypoint, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = { stdout: [], stderr: [] };
    const append = (target, chunk) => {
      target.push(Buffer.from(chunk));
      if (target.reduce((size, value) => size + value.length, 0) > 2 * 1024 * 1024) {
        child.kill('SIGTERM');
        reject(new Error('runcloud CLI emitted more than 2 MiB'));
      }
    };
    child.stdout.on('data', (chunk) => append(chunks.stdout, chunk));
    child.stderr.on('data', (chunk) => append(chunks.stderr, chunk));
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', (code, childSignal) => {
      signal?.removeEventListener('abort', abort);
      const stdout = Buffer.concat(chunks.stdout).toString('utf8').trim();
      const stderr = Buffer.concat(chunks.stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(
          `runcloud CLI failed with ${childSignal ?? `exit ${code}`}: `
            + sanitizeText(stderr || stdout || 'no diagnostic output'),
        ));
        return;
      }
      if (!parseJson) {
        resolvePromise(stdout);
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`runcloud CLI returned invalid JSON: ${sanitizeText(stdout)}`, { cause: error }));
      }
    });
  });
}

function validateAcknowledgement(value, surface, sessionId, mediaManifest) {
  assert.equal(value?.ok, true, `${surface} response omitted ok=true`);
  assert.equal(value.platform, platform, `${surface} response platform did not match`);
  assert.equal(value.sessionId, sessionId, `${surface} response session did not match`);
  assert.equal(value.bundleId, BUNDLE_ID, `${surface} response bundle did not match`);
  assert.equal(value.filename, mediaManifest.filename, `${surface} response filename did not match`);
  assert.equal(value.contentType, mediaManifest.contentType, `${surface} response media type did not match`);
  assert.equal(value.byteSize, mediaManifest.byteSize, `${surface} response byte count did not match`);
  assert.equal(typeof value.asset?.id, 'string', `${surface} response omitted media asset ID`);
  assert.equal(value.asset.contentType, mediaManifest.contentType);
  assert.equal(Number(value.asset.byteSize), mediaManifest.byteSize);
}

function acknowledgementEvidence(value) {
  return {
    ok: value.ok,
    platform: value.platform,
    sessionId: value.sessionId,
    bundleId: value.bundleId,
    filename: value.filename,
    contentType: value.contentType,
    byteSize: value.byteSize,
    source: value.source ?? null,
    pid: value.pid ?? null,
    sampleRate: value.sampleRate ?? null,
    channels: value.channels ?? null,
    sampleCount: value.sampleCount ?? null,
    durationMs: value.durationMs ?? null,
    asset: {
      id: value.asset.id,
      filename: value.asset.filename,
      contentType: value.asset.contentType,
      byteSize: value.asset.byteSize,
    },
  };
}

async function writeScreenshot(simulator, sessionId, filename, signal) {
  const bytes = Buffer.from(await simulator.screenshot(sessionId, {
    requestId: `media:${mediaRun}:${platform}:${input}:screenshot:${filename}`,
    timeoutMs: 20_000,
    signal,
  }));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.byteLength > 1_000, `${filename} was unexpectedly small`);
  await writeFile(resolve(artifactDirectory, filename), bytes);
}

async function collectFailureEvidence(sessions, failedStage) {
  const stageName = safeRunId(failedStage).slice(0, 48);
  const diagnostics = [];
  for (const retained of sessions) {
    const prefix = `${retained.surface}-failure-${stageName}`;
    const sessionEvidence = {
      surface: retained.surface,
      sessionId: retained.session.id,
      artifacts: {},
      failures: [],
    };
    try {
      const session = await retained.simulator.get(retained.session.id);
      sessionEvidence.sessionStatus = session.status;
    } catch (error) {
      sessionEvidence.failures.push({ operation: 'session', ...sanitizedFailure(asError(error)) });
    }
    try {
      const tree = await retained.simulator.accessibilityTree(retained.session.id, { timeoutMs: 20_000 });
      const filename = `${prefix}-tree.json`;
      await writeJson(filename, tree);
      sessionEvidence.artifacts.accessibilityTree = filename;
      sessionEvidence.lastAppStatus = mediaStatus(tree);
    } catch (error) {
      sessionEvidence.failures.push({ operation: 'accessibility', ...sanitizedFailure(asError(error)) });
    }
    try {
      const filename = `${prefix}.png`;
      await writeScreenshot(retained.simulator, retained.session.id, filename);
      sessionEvidence.artifacts.screenshot = filename;
    } catch (error) {
      sessionEvidence.failures.push({ operation: 'screenshot', ...sanitizedFailure(asError(error)) });
    }
    try {
      const logs = await retained.simulator.logs(retained.session.id, { tail: 300 });
      const filename = `${prefix}-logs.json`;
      await writeJson(filename, logs);
      sessionEvidence.artifacts.logs = filename;
    } catch (error) {
      sessionEvidence.failures.push({ operation: 'logs', ...sanitizedFailure(asError(error)) });
    }
    diagnostics.push(sessionEvidence);
  }
  return diagnostics;
}

async function writeJson(filename, value) {
  await writeFile(
    resolve(artifactDirectory, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function moduleSpecifier(value) {
  if (value.startsWith('/') || value.startsWith('.')) return pathToFileURL(resolve(value)).href;
  return value;
}

async function resolveModuleEntrypoint(value) {
  if (value.startsWith('/') || value.startsWith('.')) return resolve(value);
  return fileURLToPath(import.meta.resolve(value));
}

async function packageIdentity(entrypoint, expectedName) {
  let directory = dirname(entrypoint);
  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = resolve(directory, 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.name === expectedName) return { name: manifest.name, version: manifest.version };
    } catch {
      // Continue toward the package root.
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`could not locate ${expectedName} package metadata from ${entrypoint}`);
}

function sanitizedFailure(error) {
  return {
    name: error.name,
    message: sanitizeText(error.message),
    ...(Number.isInteger(error.status) ? { status: error.status } : {}),
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(typeof error.action === 'string' ? { action: error.action } : {}),
    ...(typeof error.platform === 'string' ? { platform: error.platform } : {}),
    ...(typeof error.sessionId === 'string' ? { sessionId: error.sessionId } : {}),
    ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
    ...(typeof error.details?.stage === 'string' ? { serviceStage: error.details.stage } : {}),
  };
}

function sanitizeText(value) {
  let result = String(value);
  for (const name of ['RUN_CLOUD_API_KEY', 'RUN_CLOUD_API_TOKEN']) {
    const secret = process.env[name]?.trim();
    if (secret) result = result.replaceAll(secret, '[redacted API credential]');
  }
  return result
    .replace(/(?:https?|wss):\/\/\S+/gi, '[redacted URL]')
    .replace(/rc_(?:live|test)_[A-Za-z0-9._-]+/g, '[redacted API key]')
    .slice(0, 2_000);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live media injection proof`);
  return value;
}

function oneOfEnvironment(name, choices) {
  const value = requiredEnvironment(name).toLowerCase();
  if (!choices.includes(value)) throw new Error(`${name} must be ${choices.join(' or ')}`);
  return value;
}

function safeRunId(value) {
  const result = value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  if (!result) throw new Error('RUN_CLOUD_MEDIA_RUN_ID has no usable characters');
  return result;
}

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

async function wait(milliseconds, signal) {
  await delay(milliseconds, undefined, signal ? { signal } : undefined);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw asError(signal.reason ?? 'media proof cancelled');
}
