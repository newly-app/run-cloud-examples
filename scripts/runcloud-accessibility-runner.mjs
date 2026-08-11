#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_API_URL = 'https://api.run.cloud';
const DEFAULT_IMAGE = 'runcloud/agent-base';
const DEFAULT_CPU = 2;
const DEFAULT_MEMORY = 4_096;
const DEFAULT_SANDBOX_TIMEOUT_SECONDS = 1_800;
const DEFAULT_ENVIRONMENT_TTL_SECONDS = 2_100;
const EXPECTED_SDK_VERSION = '0.22.0';
const CLEANUP_POLL_DELAY_MS = 500;
const SANDBOX_POLL_ATTEMPTS = 120;
const ENVIRONMENT_POLL_ATTEMPTS = 150;
const READINESS_POLL_DELAY_MS = 1_000;
const READINESS_POLL_ATTEMPTS = 120;
const MAX_CAPTURE_BYTES = 256 * 1_024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function runnerName(env = process.env) {
  const runId = required(env, 'GITHUB_RUN_ID');
  const attempt = required(env, 'GITHUB_RUN_ATTEMPT');
  return `accessibility-benchmark-${runId}-${attempt}`;
}

export function benchmarkRunId(env = process.env) {
  return `gha-${required(env, 'GITHUB_RUN_ID')}-${required(env, 'GITHUB_RUN_ATTEMPT')}`;
}

export function sandboxCommand() {
  return `
set -euo pipefail
umask 077
workspace=/workspace/run-cloud-accessibility
artifacts="$workspace/accessibility-benchmark/artifacts"
rm -rf "$workspace"
mkdir -p "$workspace" "$artifacts"
tar -xzf /tmp/run-cloud-accessibility-source.tar.gz -C "$workspace"

cd "$workspace/accessibility-benchmark"
set +e
{
  npm ci --ignore-scripts --no-audit --no-fund
  npm ls @run-cloud/sdk
  npm run test:live
} 2>&1 | tee "$artifacts/test-report.tap"
test_status="\${PIPESTATUS[0]}"
set -e

tar -czf /tmp/run-cloud-accessibility-results.tar.gz -C "$artifacts" .
exit "$test_status"
`.trim();
}

export function sanitizeFailure(value) {
  return String(value ?? '')
    .replace(/(?:https?|wss):\/\/\S+/gi, '[redacted URL]')
    .replace(/(?:authorization\s*:\s*bearer\s+)\S+/gi, 'Authorization: Bearer [redacted]')
    .replace(/rc_(?:live|test)_[A-Za-z0-9._-]+/g, '[redacted API key]')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .trim()
    .slice(-4_000);
}

export async function sweepMobileResources(client, runId) {
  const result = { ios: [], android: [], assets: [], errors: [] };
  for (const platform of ['ios', 'android']) {
    let sessions;
    try {
      sessions = await client[platform].list({ all: true });
    } catch (error) {
      result.errors.push(`${platform} list: ${sanitizeFailure(asError(error).message)}`);
      continue;
    }
    const owned = sessions.filter((session) =>
      session.tags?.suite === 'accessibility-benchmark'
      && session.tags?.benchmarkRun === runId,
    );
    for (const session of owned) {
      if (session.status === 'released') {
        result[platform].push({ id: session.id, result: 'already-released' });
        continue;
      }
      try {
        await client[platform].delete(session.id);
        result[platform].push({ id: session.id, result: 'released' });
      } catch (error) {
        result[platform].push({ id: session.id, result: 'release-failed' });
        result.errors.push(`${platform} ${session.id}: ${sanitizeFailure(asError(error).message)}`);
      }
    }
  }

  try {
    const assets = await client.assets.list();
    const prefix = `accessibility-benchmark-${runId}-`;
    for (const asset of assets.filter((candidate) => candidate.name?.startsWith(prefix))) {
      try {
        await client.assets.delete(asset.id);
        result.assets.push({ id: asset.id, result: 'deleted' });
      } catch (error) {
        result.assets.push({ id: asset.id, result: 'delete-failed' });
        result.errors.push(`asset ${asset.id}: ${sanitizeFailure(asError(error).message)}`);
      }
    }
  } catch (error) {
    result.errors.push(`asset list: ${sanitizeFailure(asError(error).message)}`);
  }
  return result;
}

async function requestJson({ apiUrl, token, method, path, body, fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = await response.json();
      if (typeof parsed.error === 'string' && parsed.error) detail = parsed.error;
    } catch {
      // Do not include an unstructured response body in Actions output.
    }
    throw new HttpError(response.status, detail);
  }
  if (response.status === 204) return undefined;
  return await response.json();
}

async function createEnvironment(config, fetchImpl) {
  const environment = await requestJson({
    apiUrl: config.apiUrl,
    token: config.apiKey,
    method: 'POST',
    path: '/run-cloud/ci/environments',
    body: {
      ttlSeconds: config.environmentTtlSeconds,
      maxSandboxes: 1,
      maxCpu: config.cpu,
      maxMemory: config.memory,
    },
    fetchImpl,
  });
  if (!environment?.id || !environment?.capabilityToken) {
    throw new Error('run.cloud returned an incomplete CI environment response');
  }
  return environment;
}

async function deleteEnvironment(config, environmentId, fetchImpl) {
  try {
    await requestJson({
      apiUrl: config.apiUrl,
      token: config.apiKey,
      method: 'DELETE',
      path: `/run-cloud/ci/environments/${encodeURIComponent(environmentId)}`,
      fetchImpl,
    });
    return 'requested';
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return 'deleted';
    throw error;
  }
}

async function waitForEnvironmentRelease(config, environmentId, fetchImpl, delay = setTimeout) {
  for (let attempt = 0; attempt < ENVIRONMENT_POLL_ATTEMPTS; attempt += 1) {
    try {
      const environment = await requestJson({
        apiUrl: config.apiUrl,
        token: config.apiKey,
        method: 'GET',
        path: `/run-cloud/ci/environments/${encodeURIComponent(environmentId)}`,
        fetchImpl,
      });
      if (environment?.status === 'deleted') return 'deleted';
      if (environment?.status === 'expired') return 'expired/released';
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return 'deleted';
      throw error;
    }
    await new Promise((resolveDelay) => delay(resolveDelay, CLEANUP_POLL_DELAY_MS));
  }
  return 'delete-requested';
}

async function waitForSandboxRunning(client, sandboxId, delay = setTimeout) {
  for (let attempt = 0; attempt < READINESS_POLL_ATTEMPTS; attempt += 1) {
    const sandbox = await client.sandboxes.get(sandboxId);
    if (sandbox.state === 'running') return sandbox;
    if (['destroyed', 'interrupted', 'stopped'].includes(sandbox.state)) {
      throw new Error(`run.cloud runner entered ${sandbox.state} before it was ready`);
    }
    await new Promise((resolveDelay) => delay(resolveDelay, READINESS_POLL_DELAY_MS));
  }
  throw new Error('run.cloud runner did not become ready within 120 seconds');
}

async function destroySandbox(client, sandboxId, delay = setTimeout) {
  for (let attempt = 0; attempt < SANDBOX_POLL_ATTEMPTS; attempt += 1) {
    try {
      await client.sandboxes.destroy(sandboxId);
      break;
    } catch (error) {
      if (error?.status === 404) return 'destroyed';
      if (![409, 429, 500, 502, 503, 504].includes(error?.status)) throw error;
      if (attempt + 1 === SANDBOX_POLL_ATTEMPTS) throw error;
      await new Promise((resolveDelay) => delay(resolveDelay, CLEANUP_POLL_DELAY_MS));
    }
  }
  for (let attempt = 0; attempt < SANDBOX_POLL_ATTEMPTS; attempt += 1) {
    try {
      const sandbox = await client.sandboxes.get(sandboxId);
      if (sandbox.state === 'destroyed') return 'destroyed';
    } catch (error) {
      if (error?.status === 404) return 'destroyed';
      throw error;
    }
    await new Promise((resolveDelay) => delay(resolveDelay, CLEANUP_POLL_DELAY_MS));
  }
  return 'destroy-requested';
}

export async function cleanupResources({
  config,
  state,
  Client,
  fetchImpl = fetch,
  delay = setTimeout,
}) {
  const client = new Client({ apiKey: config.apiKey, apiUrl: config.apiUrl });
  const mobile = await sweepMobileResources(client, state.benchmarkRun ?? config.benchmarkRun);
  let sandbox = state.sandboxId ? 'destroy-requested' : 'not-created';
  let environment = state.environmentId ? 'delete-requested' : 'not-created';

  if (state.sandboxId) {
    sandbox = await destroySandbox(client, state.sandboxId, delay);
  } else if (state.runnerName) {
    const matches = await client.sandboxes.list({ name: state.runnerName });
    for (const match of matches) await client.sandboxes.destroy(match.id);
    sandbox = matches.length === 0 ? 'not-created' : 'destroy-requested';
  }

  if (state.environmentId) {
    await deleteEnvironment(config, state.environmentId, fetchImpl);
    environment = await waitForEnvironmentRelease(
      config,
      state.environmentId,
      fetchImpl,
      delay,
    );
  }
  return { sandbox, environment, mobile };
}

function configFromEnv(env, cleanupOnly = false) {
  const runnerTemp = required(env, 'RUNNER_TEMP');
  const resultsDirectory = resolve(
    env.RUN_CLOUD_BENCHMARK_RESULTS_DIR?.trim()
      || `${runnerTemp}/runcloud-accessibility-results`,
  );
  const base = {
    apiKey: required(env, 'RUN_CLOUD_API_KEY'),
    apiUrl: env.RUN_CLOUD_API_URL?.trim() || DEFAULT_API_URL,
    sdkPath: env.RUN_CLOUD_SDK_PATH?.trim() || '',
    expectedSdkVersion: env.RUN_CLOUD_SDK_VERSION?.trim() || EXPECTED_SDK_VERSION,
    runnerName: runnerName(env),
    benchmarkRun: benchmarkRunId(env),
    runId: required(env, 'GITHUB_RUN_ID'),
    runAttempt: required(env, 'GITHUB_RUN_ATTEMPT'),
    repository: env.GITHUB_REPOSITORY?.trim() || '',
    image: env.RUN_CLOUD_IMAGE?.trim() || DEFAULT_IMAGE,
    cpu: positiveNumber(env, 'RUN_CLOUD_CPU', DEFAULT_CPU),
    memory: positiveInteger(env, 'RUN_CLOUD_MEMORY', DEFAULT_MEMORY),
    sandboxTimeoutSeconds: positiveInteger(
      env,
      'RUN_CLOUD_TIMEOUT_SECONDS',
      DEFAULT_SANDBOX_TIMEOUT_SECONDS,
    ),
    environmentTtlSeconds: positiveInteger(
      env,
      'RUN_CLOUD_ENVIRONMENT_TTL_SECONDS',
      DEFAULT_ENVIRONMENT_TTL_SECONDS,
    ),
    statePath: resolve(
      env.RUN_CLOUD_BENCHMARK_STATE_PATH?.trim()
        || `${runnerTemp}/runcloud-accessibility-runner-state.json`,
    ),
    resultsDirectory,
    summaryPath: env.GITHUB_STEP_SUMMARY?.trim() || '',
  };
  if (cleanupOnly) return base;
  return {
    ...base,
    sourceArchive: resolve(required(env, 'RUN_CLOUD_BENCHMARK_SOURCE_ARCHIVE')),
    iosApp: resolve(required(env, 'RUN_CLOUD_BENCHMARK_IOS_APP')),
    androidApp: resolve(required(env, 'RUN_CLOUD_BENCHMARK_ANDROID_APP')),
  };
}

async function importClient(sdkPath) {
  if (!sdkPath) throw new Error('RUN_CLOUD_SDK_PATH is required');
  const module = await import(pathToFileURL(sdkPath).href);
  if (typeof module.Client !== 'function') throw new Error('run.cloud SDK does not export Client');
  return module.Client;
}

async function installedSdkVersion(sdkPath) {
  const manifestPath = resolve(dirname(sdkPath), '..', 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  return manifest.version;
}

async function persistState(path, state) {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function readState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function appendSummary(path, markdown) {
  if (!path) return;
  await appendFile(path, `${markdown.trim()}\n\n`, 'utf8');
}

function captureStream(destination, capture) {
  return (chunk) => {
    destination.write(chunk);
    capture.value += Buffer.from(chunk).toString('utf8');
    if (Buffer.byteLength(capture.value) > MAX_CAPTURE_BYTES) {
      capture.value = capture.value.slice(-MAX_CAPTURE_BYTES);
    }
  };
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function writeRunnerReport(config, state, fields = {}) {
  await mkdir(config.resultsDirectory, { recursive: true });
  const report = {
    schemaVersion: 1,
    repository: config.repository,
    githubRunId: config.runId,
    githubRunAttempt: config.runAttempt,
    benchmarkRun: config.benchmarkRun,
    runner: {
      kind: 'run.cloud sandbox',
      name: state.runnerName || config.runnerName,
      sandboxId: state.sandboxId || null,
      environmentId: state.environmentId || null,
      image: config.image,
      cpu: config.cpu,
      memoryMiB: config.memory,
      hardTimeoutSeconds: config.sandboxTimeoutSeconds,
      environmentTtlSeconds: config.environmentTtlSeconds,
    },
    publicSdk: {
      package: '@run-cloud/sdk',
      version: fields.sdkVersion ?? config.expectedSdkVersion,
    },
    ...fields,
  };
  await writeFile(
    resolve(config.resultsDirectory, 'runner-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return report;
}

async function downloadTestArtifacts(client, sandboxId, config) {
  const archive = await client.sandboxes.readFile(
    sandboxId,
    '/tmp/run-cloud-accessibility-results.tar.gz',
  );
  const archivePath = resolve(config.resultsDirectory, 'test-artifacts.tar.gz');
  await writeFile(archivePath, archive);
  await execFileAsync('tar', ['-xzf', archivePath, '-C', config.resultsDirectory]);
}

function runnerSummary(config, state, outcome, failure) {
  return `
## run.cloud accessibility benchmark runner

| Field | Value |
| --- | --- |
| Runner | run.cloud sandbox \`${state.sandboxId || 'not created'}\` |
| CI environment | \`${state.environmentId || 'not created'}\` |
| Image | \`${config.image}\` |
| Reservation | ${config.cpu} cores / ${config.memory} MiB |
| Public SDK | \`@run-cloud/sdk@${config.expectedSdkVersion}\` |
| Benchmark run | \`${config.benchmarkRun}\` |
| Outcome | **${outcome}** |

${failure ? `**Actionable failure:** ${sanitizeFailure(failure)}` : 'Both native benchmark apps completed the published-SDK accessibility test.'}
`;
}

function cleanupSummary(state, cleanup) {
  const mobileErrors = cleanup.mobile.errors.length
    ? cleanup.mobile.errors.map((error) => `- ${error}`).join('\n')
    : 'None.';
  return `
## run.cloud accessibility cleanup

| Resource | Identifier | Result |
| --- | --- | --- |
| Sandbox | \`${state.sandboxId || state.runnerName || 'not created'}\` | ${cleanup.sandbox} |
| CI environment | \`${state.environmentId || 'not created'}\` | ${cleanup.environment} |
| iOS benchmark sessions | ${cleanup.mobile.ios.length} matched | ${cleanup.mobile.ios.map(({ result }) => result).join(', ') || 'none'} |
| Android benchmark sessions | ${cleanup.mobile.android.length} matched | ${cleanup.mobile.android.map(({ result }) => result).join(', ') || 'none'} |
| Benchmark assets | ${cleanup.mobile.assets.length} matched | ${cleanup.mobile.assets.map(({ result }) => result).join(', ') || 'none'} |

Cleanup errors: ${mobileErrors}

The API credential and CI capability were not written to the sandbox filesystem,
runner state, summary, or uploaded artifacts. Session and sandbox hard timeouts
remain armed as independent fallbacks.
`;
}

async function runMain(config, dependencies = {}) {
  await mkdir(config.resultsDirectory, { recursive: true });
  const Client = dependencies.Client ?? (await importClient(config.sdkPath));
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sdkVersion = dependencies.sdkVersion ?? await installedSdkVersion(config.sdkPath);
  if (sdkVersion !== config.expectedSdkVersion) {
    throw new Error(`installed @run-cloud/sdk is ${sdkVersion}; expected ${config.expectedSdkVersion}`);
  }

  const state = {
    schemaVersion: 1,
    runnerName: config.runnerName,
    benchmarkRun: config.benchmarkRun,
    environmentId: '',
    sandboxId: '',
  };
  await persistState(config.statePath, state);
  await writeRunnerReport(config, state, { sdkVersion, outcome: 'starting' });

  let capabilityToken = '';
  let operationError;
  let failure = '';
  let inputs;
  let cleanupPromise;
  const cleanupOnce = () => {
    cleanupPromise ??= cleanupResources({
      config,
      state,
      Client,
      fetchImpl,
      delay: dependencies.delay,
    });
    return cleanupPromise;
  };

  const handleSignal = (signal) => {
    console.warn(`Received ${signal}; releasing run.cloud benchmark resources.`);
    void cleanupOnce()
      .catch((error) => console.error(`Cleanup after ${signal} failed: ${sanitizeFailure(error.message)}`))
      .finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    const environment = await createEnvironment(config, fetchImpl);
    state.environmentId = environment.id;
    capabilityToken = environment.capabilityToken;
    await persistState(config.statePath, state);

    const runnerClient = new Client({ apiKey: capabilityToken, apiUrl: config.apiUrl });
    const sandbox = await runnerClient.sandboxes.create({
      image: config.image,
      cpu: config.cpu,
      memory: config.memory,
      timeoutSeconds: config.sandboxTimeoutSeconds,
      name: config.runnerName,
      idempotencyKey: `${config.repository}:${config.runId}:${config.runAttempt}:accessibility`,
    });
    state.sandboxId = sandbox.id;
    await persistState(config.statePath, state);
    await waitForSandboxRunning(runnerClient, state.sandboxId, dependencies.delay);
    console.log(
      `::notice title=run.cloud runner::sandbox=${state.sandboxId} environment=${state.environmentId} image=${config.image}`,
    );

    inputs = {
      sourceArchiveSha256: await sha256(config.sourceArchive),
      iosAppSha256: await sha256(config.iosApp),
      androidAppSha256: await sha256(config.androidApp),
    };
    await writeRunnerReport(config, state, { sdkVersion, inputs, outcome: 'running' });
    await Promise.all([
      runnerClient.sandboxes.writeFile(
        state.sandboxId,
        '/tmp/run-cloud-accessibility-source.tar.gz',
        await readFile(config.sourceArchive),
        { mode: 0o600 },
      ),
      runnerClient.sandboxes.writeFile(
        state.sandboxId,
        '/tmp/RunCloudProof.app.tar.gz',
        await readFile(config.iosApp),
        { mode: 0o600 },
      ),
      runnerClient.sandboxes.writeFile(
        state.sandboxId,
        '/tmp/RunCloudProof.apk',
        await readFile(config.androidApp),
        { mode: 0o600 },
      ),
    ]);

    const capture = { value: '' };
    const result = await runnerClient.sandboxes.exec(
      state.sandboxId,
      ['bash', '-lc', sandboxCommand()],
      {
        env: {
          RUN_CLOUD_API_KEY: config.apiKey,
          RUN_CLOUD_API_URL: config.apiUrl,
          RUN_CLOUD_BENCHMARK_RUN_ID: config.benchmarkRun,
          RUN_CLOUD_BENCHMARK_IOS_APP: '/tmp/RunCloudProof.app.tar.gz',
          RUN_CLOUD_BENCHMARK_ANDROID_APP: '/tmp/RunCloudProof.apk',
          RUN_CLOUD_BENCHMARK_ARTIFACT_DIR:
            '/workspace/run-cloud-accessibility/accessibility-benchmark/artifacts',
        },
        timeoutSeconds: config.sandboxTimeoutSeconds,
        onStdout: captureStream(process.stdout, capture),
        onStderr: captureStream(process.stderr, capture),
      },
    );

    try {
      await downloadTestArtifacts(runnerClient, state.sandboxId, config);
    } catch (error) {
      await writeFile(
        resolve(config.resultsDirectory, 'artifact-retrieval-failure.json'),
        `${JSON.stringify({ failure: sanitizeFailure(asError(error).message) }, null, 2)}\n`,
        'utf8',
      );
      if (result.exitCode === 0) throw error;
    }
    if (result.exitCode !== 0) {
      const tail = capture.value.split('\n').filter(Boolean).slice(-20).join('; ');
      failure = sanitizeFailure(tail || `benchmark exited with code ${result.exitCode}`);
      console.error(`::error title=native accessibility benchmark failed::${failure}`);
      throw new Error(failure);
    }
    await writeRunnerReport(config, state, { sdkVersion, inputs, outcome: 'passed' });
  } catch (error) {
    operationError = asError(error);
    failure ||= sanitizeFailure(operationError.message);
    await writeRunnerReport(config, state, {
      sdkVersion,
      ...(inputs ? { inputs } : {}),
      outcome: 'failed',
      failure,
    });
  }

  let cleanupError;
  try {
    await appendSummary(
      config.summaryPath,
      runnerSummary(config, state, operationError ? 'failed' : 'passed', failure),
    );
    const cleanup = await cleanupOnce();
    await writeFile(
      resolve(config.resultsDirectory, 'controller-cleanup.json'),
      `${JSON.stringify(cleanup, null, 2)}\n`,
      'utf8',
    );
    await appendSummary(config.summaryPath, cleanupSummary(state, cleanup));
    if (cleanup.mobile.errors.length > 0) {
      throw new Error(`mobile cleanup errors: ${cleanup.mobile.errors.join('; ')}`);
    }
    console.log(
      `run.cloud cleanup confirmed: sandbox=${cleanup.sandbox}; environment=${cleanup.environment}`,
    );
  } catch (error) {
    cleanupError = asError(error);
    console.error(`::error title=run.cloud cleanup failed::${sanitizeFailure(cleanupError.message)}`);
  } finally {
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
  }

  if (operationError && cleanupError) {
    throw new AggregateError([operationError, cleanupError], 'benchmark and cleanup failed');
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
}

async function runCleanup(config, dependencies = {}) {
  await mkdir(config.resultsDirectory, { recursive: true });
  const state = await readState(config.statePath);
  if (!state.environmentId && !state.sandboxId && !state.runnerName) {
    const cleanup = {
      sandbox: 'not-created',
      environment: 'not-created',
      mobile: { ios: [], android: [], assets: [], errors: [] },
    };
    await writeFile(
      resolve(config.resultsDirectory, 'controller-cleanup-confirmation.json'),
      `${JSON.stringify(cleanup, null, 2)}\n`,
      'utf8',
    );
    await appendSummary(config.summaryPath, cleanupSummary({}, cleanup));
    return;
  }
  const Client = dependencies.Client ?? (await importClient(config.sdkPath));
  const cleanup = await cleanupResources({
    config,
    state,
    Client,
    fetchImpl: dependencies.fetchImpl ?? fetch,
    delay: dependencies.delay,
  });
  await writeFile(
    resolve(config.resultsDirectory, 'controller-cleanup-confirmation.json'),
    `${JSON.stringify(cleanup, null, 2)}\n`,
    'utf8',
  );
  await appendSummary(config.summaryPath, cleanupSummary(state, cleanup));
  console.log(
    `run.cloud cleanup confirmed: sandbox=${cleanup.sandbox}; environment=${cleanup.environment}`,
  );
  if (cleanup.mobile.errors.length > 0) {
    throw new Error(`mobile cleanup errors: ${cleanup.mobile.errors.join('; ')}`);
  }
}

export async function cli(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const cleanupOnly = argv.includes('--cleanup');
  const config = configFromEnv(env, cleanupOnly);
  if (cleanupOnly) return await runCleanup(config, dependencies);
  return await runMain(config, dependencies);
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveNumber(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function positiveInteger(env, name, fallback) {
  const value = positiveNumber(env, name, fallback);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((error) => {
    console.error(sanitizeFailure(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
