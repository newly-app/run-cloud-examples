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

const SESSION_READY_TIMEOUT_MS = 180_000;
const POLL_DELAY_MS = 1_000;
const MAX_CLI_OUTPUT_BYTES = 2 * 1024 * 1024;

export const platform = oneOfEnvironment('RUN_CLOUD_PROOF_PLATFORM', ['ios', 'android']);
export const proofRun = safeRunId(requiredEnvironment('RUN_CLOUD_PROOF_RUN_ID'));
export const artifactDirectory = resolve(requiredEnvironment('RUN_CLOUD_PROOF_ARTIFACT_DIR'));
export const sdkEntrypoint = process.env.RUN_CLOUD_SDK_ENTRYPOINT?.trim() || '@run-cloud/sdk';
export const cliEntrypoint = resolve(
  process.env.RUN_CLOUD_CLI_ENTRYPOINT?.trim()
    || resolve(import.meta.dirname, 'node_modules/runcloud/dist/run-cloud.js'),
);

const stagePath = resolve(artifactDirectory, 'stages.jsonl');
let currentStage = 'initialization';

await mkdir(artifactDirectory, { recursive: true });
await writeFile(stagePath, '', 'utf8');

export async function loadPublicSurface(feature, signal) {
  const sdkModule = await stage('package-sdk-load', async () =>
    await import(moduleSpecifier(sdkEntrypoint)));
  assert.equal(typeof sdkModule.Client, 'function', 'SDK package omitted Client');
  await stage('package-cli-load', async () => access(cliEntrypoint));
  const packages = {
    sdk: await packageIdentity(await resolveModuleEntrypoint(sdkEntrypoint), '@run-cloud/sdk'),
    cli: await packageIdentity(cliEntrypoint, 'runcloud'),
  };
  const cloud = new sdkModule.Client();
  const simulator = cloud[platform];
  const account = await stage('authenticate', async () => await cloud.account());
  assert.ok(account.userId, 'authenticated account omitted userId');
  assert.ok(Array.isArray(account.orgs), 'authenticated account omitted orgs');
  await stage('package-public-contract', async () => {
    for (const method of [
      'create',
      'get',
      'delete',
      'openUrl',
      'screenshot',
      'startRecording',
      'stopRecording',
      'getRecording',
      'downloadRecording',
    ]) {
      assert.equal(typeof simulator[method], 'function', `SDK omitted ${platform}.${method}`);
    }
    await invokeCli([platform, 'open-url', '--help'], signal, false);
    await invokeCli([platform, 'recording', '--help'], signal, false);
  });
  await writeJson('runner.json', {
    schemaVersion: 1,
    feature,
    platform,
    proofRun,
    runner: {
      kind: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'local',
      name: process.env.RUNNER_NAME ?? null,
      os: process.env.RUNNER_OS ?? process.platform,
      arch: process.env.RUNNER_ARCH ?? process.arch,
    },
    github: {
      repository: process.env.GITHUB_REPOSITORY ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      job: process.env.GITHUB_JOB ?? null,
      sha: process.env.GITHUB_SHA ?? null,
    },
    packages,
  });
  return { cloud, simulator, packages };
}

export async function stage(name, operation) {
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

export function failedStage() {
  return currentStage;
}

export async function createSession(surface, simulator, signal, options = {}) {
  if (surface === 'sdk') {
    const initial = await simulator.create({
      displayName: `proof:${proofRun}:${platform}:${options.feature ?? 'session'}:sdk`,
      tags: proofTags(options.feature ?? 'session', surface),
      inactivityTimeout: options.inactivityTimeout ?? '5m',
      hardTimeout: options.hardTimeout ?? '15m',
    });
    return await waitUntilActive('sdk', simulator, initial, signal);
  }
  const args = [
    platform,
    'create',
    '--display-name',
    `proof:${proofRun}:${platform}:${options.feature ?? 'session'}:cli`,
    '--label',
    'suite=native-session-proofs',
    '--label',
    `proofRun=${proofRun}`,
    '--label',
    `feature=${options.feature ?? 'session'}`,
    '--label',
    'surface=cli',
    '--inactivity-timeout',
    options.inactivityTimeout ?? '5m',
    '--hard-timeout',
    options.hardTimeout ?? '15m',
    '--json',
  ];
  const initial = await invokeCli(args, signal);
  return await waitUntilActive('cli', simulator, initial, signal);
}

export async function getSession(surface, simulator, id, signal) {
  return surface === 'sdk'
    ? await simulator.get(id)
    : await invokeCli([platform, 'get', id, '--json'], signal);
}

export async function releaseSession(surface, simulator, id, signal) {
  return surface === 'sdk'
    ? await simulator.delete(id)
    : await invokeCli([platform, 'delete', id, '--json'], signal);
}

export async function invokeCli(args, signal, parseJson = true) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliEntrypoint, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = { stdout: [], stderr: [] };
    let outputBytes = 0;
    const append = (target, chunk) => {
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.byteLength;
      if (outputBytes > MAX_CLI_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        reject(new Error('runcloud CLI emitted more than 2 MiB'));
        return;
      }
      target.push(bytes);
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

export async function writeJson(filename, value) {
  await writeFile(
    resolve(artifactDirectory, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

export async function writeBytes(filename, value) {
  const bytes = Buffer.from(value);
  await writeFile(resolve(artifactDirectory, filename), bytes);
  return bytes;
}

export async function readArtifact(filename) {
  return await readFile(resolve(artifactDirectory, filename));
}

export function assertPng(bytes, label) {
  const value = Buffer.from(bytes);
  assert.deepEqual([...value.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10],
    `${label} omitted the PNG signature`);
  assert.ok(value.byteLength > 1_000, `${label} was unexpectedly small`);
  return {
    filename: label,
    contentType: 'image/png',
    byteSize: value.byteLength,
    sha256: sha256(value),
  };
}

export function assertMp4(bytes, recording, label) {
  const value = Buffer.from(bytes);
  assert.equal(value.subarray(4, 8).toString('ascii'), 'ftyp', `${label} omitted an MP4 ftyp box`);
  assert.ok(value.byteLength > 1_000, `${label} was unexpectedly small`);
  assert.ok(value.includes(Buffer.from('moov')), `${label} omitted an MP4 moov box`);
  assert.ok(value.includes(Buffer.from('mdat')), `${label} omitted an MP4 mdat box`);
  assert.equal(recording.status, 'ready', `${label} recording was not ready`);
  assert.equal(recording.contentType, 'video/mp4', `${label} content type did not match`);
  assert.equal(Number(recording.byteSize), value.byteLength, `${label} byte count did not match`);
  assert.ok(Number(recording.durationMs) >= 1_000, `${label} duration was too short`);
  const checksum = sha256(value);
  if (recording.checksum?.algorithm === 'sha256') {
    assert.equal(recording.checksum.value, checksum, `${label} checksum did not match`);
  }
  return {
    filename: label,
    contentType: 'video/mp4',
    byteSize: value.byteLength,
    durationMs: recording.durationMs,
    sha256: checksum,
  };
}

export function sessionEvidence(session) {
  return {
    id: session.id,
    platform: session.platform,
    status: session.status,
    device: session.device ?? null,
    codec: session.codec,
    createdAt: session.createdAt,
    releasedAt: session.releasedAt ?? null,
    expiresAt: session.expiresAt ?? null,
    inactivityTimeoutSeconds: session.inactivityTimeoutSeconds ?? null,
  };
}

export function recordingEvidence(recording) {
  return {
    id: recording.id,
    sessionId: recording.sessionId,
    platform: recording.platform,
    status: recording.status,
    contentType: recording.contentType,
    byteSize: recording.byteSize,
    checksum: recording.checksum,
    durationMs: recording.durationMs,
    attempts: recording.attempts,
    failure: recording.failure,
    startedAt: recording.startedAt,
    stoppedAt: recording.stoppedAt,
    readyAt: recording.readyAt,
    retentionExpiresAt: recording.retentionExpiresAt,
  };
}

export function usageSeconds(report, orgId, meter) {
  const row = report.items.find((item) => item.org_id === orgId && item.meter === meter);
  return row ? Number(row.seconds) : 0;
}

export function sanitizedFailure(error) {
  return {
    name: error.name,
    message: sanitizeText(error.message),
    ...(Number.isInteger(error.status) ? { status: error.status } : {}),
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(typeof error.action === 'string' ? { action: error.action } : {}),
    ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
  };
}

export function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

export async function wait(milliseconds, signal) {
  await delay(milliseconds, undefined, signal ? { signal } : undefined);
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw asError(signal.reason ?? 'session proof cancelled');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function waitUntilActive(surface, simulator, initialSession, signal) {
  const deadline = Date.now() + SESSION_READY_TIMEOUT_MS;
  let session = initialSession;
  while (session.status !== 'active') {
    throwIfAborted(signal);
    if (session.status === 'failed' || session.status === 'released') {
      throw new Error(`session ${session.id} became ${session.status} before it was ready`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`session ${session.id} was not active within ${SESSION_READY_TIMEOUT_MS} ms`);
    }
    await wait(POLL_DELAY_MS, signal);
    session = await getSession(surface, simulator, session.id, signal);
  }
  return session;
}

async function appendStage(value) {
  await appendFile(stagePath, `${JSON.stringify(value)}\n`, 'utf8');
  console.log(`[${value.status}] ${value.stage}`);
}

function proofTags(feature, surface) {
  return {
    suite: 'native-session-proofs',
    proofRun,
    feature,
    surface,
  };
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
  if (!value) throw new Error(`${name} is required for the live native session proof`);
  return value;
}

function oneOfEnvironment(name, choices) {
  const value = requiredEnvironment(name).toLowerCase();
  if (!choices.includes(value)) throw new Error(`${name} must be ${choices.join(' or ')}`);
  return value;
}

function safeRunId(value) {
  const result = value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  if (!result) throw new Error('RUN_CLOUD_PROOF_RUN_ID has no usable characters');
  return result;
}
