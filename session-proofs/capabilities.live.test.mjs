import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  artifactDirectory,
  asError,
  assertMp4,
  assertPng,
  createSession,
  failedStage,
  getSession,
  invokeCli,
  loadPublicSurface,
  platform,
  proofRun,
  readArtifact,
  recordingEvidence,
  releaseSession,
  sanitizedFailure,
  sessionEvidence,
  stage,
  wait,
  withTransientEdgeRetry,
  writeBytes,
  writeJson,
} from './support.mjs';

const RECORDING_READY_TIMEOUT_MS = 180_000;
const HTTPS_PROOF_URL = 'https://example.com/';

test(
  `${platform} opens HTTPS URLs, captures PNGs, and downloads real MP4 recordings through the public SDK and CLI`,
  { timeout: 20 * 60_000 },
  async (context) => {
    await runCapabilitiesProof(context.signal);
  },
);

async function runCapabilitiesProof(signal) {
  const sessions = [];
  const recordings = [];
  const cleanup = [];
  let operationError;
  let cloud;
  let simulator;

  try {
    ({ cloud, simulator } = await loadPublicSurface('open-url-screenshot-recording', signal));
    const surfaces = [];
    for (const surface of ['sdk', 'cli']) {
      const prefix = surface;
      const session = await stage(`${prefix}-session-create`, async () =>
        await createSession(surface, simulator, signal, {
          feature: 'open-url-screenshot-recording',
          inactivityTimeout: '5m',
          hardTimeout: '15m',
        }));
      sessions.push({ surface, session });
      await writeJson(`${prefix}-session.json`, sessionEvidence(session));

      const started = await stage(`${prefix}-recording-start`, async () =>
        await startRecording(surface, simulator, session.id, signal));
      assertRecordingIdentity(started, session.id, ['starting', 'recording']);
      recordings.push({ surface, sessionId: session.id, recording: started });
      await writeJson(`${prefix}-recording-started.json`, recordingEvidence(started));

      const recording = await stage(`${prefix}-recording-active`, async () =>
        await waitForRecording(surface, simulator, session.id, started.id, ['recording'], signal));
      recordings.at(-1).recording = recording;

      const targetUrl = `${HTTPS_PROOF_URL}?runcloud-proof=${encodeURIComponent(`${proofRun}-${platform}-${surface}`)}`;
      const opened = await stage(`${prefix}-production-open-url`, async () =>
        await openUrl(surface, simulator, session.id, targetUrl, signal));
      assert.equal(opened?.ok, true, `${surface} open-url omitted ok=true`);
      assert.equal(opened.platform, platform, `${surface} open-url platform did not match`);
      assert.equal(opened.sessionId, session.id, `${surface} open-url session did not match`);
      assert.equal(opened.url, targetUrl, `${surface} open-url changed the requested URL`);
      await writeJson(`${prefix}-open-url.json`, {
        ok: opened.ok,
        platform: opened.platform,
        sessionId: opened.sessionId,
        device: opened.device,
        leaseId: opened.leaseId,
        url: opened.url,
      });

      await wait(4_000, signal);
      const screenshotFilename = `${prefix}-open-url.png`;
      const screenshot = await stage(`${prefix}-screenshot`, async () =>
        await captureScreenshot(surface, simulator, session.id, screenshotFilename, signal));
      const screenshotProof = assertPng(screenshot, screenshotFilename);

      await wait(3_000, signal);
      const stopped = await stage(`${prefix}-recording-stop`, async () =>
        await stopRecording(surface, simulator, session.id, recording.id, signal));
      assertRecordingIdentity(stopped, session.id, ['finalizing', 'ready']);
      recordings.at(-1).recording = stopped;
      await writeJson(`${prefix}-recording-stopped.json`, recordingEvidence(stopped));

      const ready = await stage(`${prefix}-recording-ready`, async () =>
        await waitForRecording(surface, simulator, session.id, recording.id, ['ready'], signal));
      recordings.at(-1).recording = ready;
      await writeJson(`${prefix}-recording-ready.json`, recordingEvidence(ready));

      const recordingFilename = `${prefix}-screen-recording.mp4`;
      const bytes = await stage(`${prefix}-recording-download`, async () =>
        await downloadRecording(
          surface,
          simulator,
          session.id,
          recording.id,
          recordingFilename,
          signal,
        ));
      const recordingProof = assertMp4(bytes, ready, recordingFilename);

      surfaces.push({
        surface,
        sessionId: session.id,
        openUrl: { ok: true, url: targetUrl },
        screenshot: screenshotProof,
        recording: {
          ...recordingEvidence(ready),
          artifact: recordingProof,
        },
        outcome: 'passed',
      });

      await stage(`${prefix}-session-release`, async () => {
        const released = await withTransientEdgeRetry(
          () => releaseSession(surface, simulator, session.id, signal),
          signal,
        );
        assert.equal(released.status, 'released', `${surface} session did not release`);
        cleanup.push({ resource: 'session', surface, id: session.id, outcome: 'released' });
        sessions.splice(sessions.findIndex((item) => item.session.id === session.id), 1);
      });
    }

    await writeJson('result.json', {
      schemaVersion: 1,
      feature: 'open-url-screenshot-recording',
      platform,
      proofRun,
      surfaces,
      outcome: 'passed',
    });
  } catch (error) {
    operationError = asError(error);
    await writeJson('failure.json', {
      schemaVersion: 1,
      feature: 'open-url-screenshot-recording',
      platform,
      proofRun,
      stage: failedStage(),
      failure: sanitizedFailure(operationError),
      sessions: await collectSessionDiagnostics(simulator, sessions, recordings),
    });
  }

  if (simulator) {
    for (const retained of [...sessions].reverse()) {
      try {
        const released = await withTransientEdgeRetry(
          () => releaseSession(retained.surface, simulator, retained.session.id, signal),
          signal,
        );
        cleanup.push({
          resource: 'session',
          surface: retained.surface,
          id: retained.session.id,
          outcome: released.status === 'released' ? 'released' : `unexpected-${released.status}`,
        });
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
  }
  for (const retained of recordings) {
    cleanup.push({
      resource: 'recording',
      surface: retained.surface,
      id: retained.recording.id,
      outcome: retained.recording.status === 'ready' ? 'retained-until-expiry' : retained.recording.status,
      retentionExpiresAt: retained.recording.retentionExpiresAt,
    });
  }
  await writeJson('cleanup.json', {
    schemaVersion: 1,
    feature: 'open-url-screenshot-recording',
    platform,
    proofRun,
    resources: cleanup,
    outcome: cleanup.some((item) => item.outcome === 'release-failed') ? 'failed' : 'complete',
  });

  const cleanupFailures = cleanup.filter((item) => item.outcome === 'release-failed');
  if (operationError && cleanupFailures.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupFailures.map((item) => new Error(JSON.stringify(item)))],
      `${platform} capability proof failed and cleanup did not complete`,
      { cause: operationError },
    );
  }
  if (operationError) throw operationError;
  if (cleanupFailures.length > 0) {
    throw new Error(`${platform} capability proof passed but cleanup did not complete`);
  }
}

async function startRecording(surface, simulator, sessionId, signal) {
  return await withTransientEdgeRetry(
    async () => surface === 'sdk'
      ? await simulator.startRecording(sessionId, {
        idempotencyKey: `proof-${proofRun}-${platform}-sdk`,
      })
      : await invokeCli([
        platform,
        'recording',
        'start',
        sessionId,
        '--idempotency-key',
        `proof-${proofRun}-${platform}-cli`,
        '--json',
      ], signal),
    signal,
  );
}

async function openUrl(surface, simulator, sessionId, url, signal) {
  return await withTransientEdgeRetry(
    async () => surface === 'sdk'
      ? await simulator.openUrl(sessionId, url)
      : await invokeCli([platform, 'open-url', url, '--id', sessionId, '--json'], signal),
    signal,
  );
}

async function captureScreenshot(surface, simulator, sessionId, filename, signal) {
  if (surface === 'sdk') {
    const bytes = await withTransientEdgeRetry(
      () => simulator.screenshot(sessionId, {
        requestId: `proof:${proofRun}:${platform}:sdk:screenshot`,
        timeoutMs: 20_000,
        signal,
      }),
      signal,
    );
    return await writeBytes(filename, bytes);
  }
  const output = resolve(artifactDirectory, filename);
  await withTransientEdgeRetry(
    () => invokeCli([platform, 'screenshot', sessionId, '--output', output], signal, false),
    signal,
  );
  return await readArtifact(filename);
}

async function stopRecording(surface, simulator, sessionId, recordingId, signal) {
  return await withTransientEdgeRetry(
    async () => surface === 'sdk'
      ? await simulator.stopRecording(sessionId, recordingId)
      : await invokeCli([
        platform,
        'recording',
        'stop',
        sessionId,
        recordingId,
        '--json',
      ], signal),
    signal,
  );
}

async function getRecording(surface, simulator, sessionId, recordingId, signal) {
  return await withTransientEdgeRetry(
    async () => surface === 'sdk'
      ? await simulator.getRecording(sessionId, recordingId)
      : await invokeCli([
        platform,
        'recording',
        'status',
        sessionId,
        recordingId,
        '--json',
      ], signal),
    signal,
  );
}

async function waitForRecording(
  surface,
  simulator,
  sessionId,
  recordingId,
  expectedStatuses,
  signal,
) {
  const deadline = Date.now() + RECORDING_READY_TIMEOUT_MS;
  let recording;
  while (Date.now() < deadline) {
    recording = await getRecording(surface, simulator, sessionId, recordingId, signal);
    if (expectedStatuses.includes(recording.status)) return recording;
    if (recording.status === 'failed' || recording.status === 'deleted') {
      throw new Error(
        `${surface} recording ${recordingId} became ${recording.status}: `
          + `${recording.failure?.code ?? 'no failure code'}`,
      );
    }
    await wait(1_000, signal);
  }
  throw new Error(
    `${surface} recording ${recordingId} did not become ${expectedStatuses.join(' or ')}; `
      + `last status ${recording?.status ?? 'unavailable'}`,
  );
}

async function downloadRecording(
  surface,
  simulator,
  sessionId,
  recordingId,
  filename,
  signal,
) {
  if (surface === 'sdk') {
    const bytes = await withTransientEdgeRetry(
      () => simulator.downloadRecording(sessionId, recordingId),
      signal,
    );
    return await writeBytes(filename, bytes);
  }
  const output = resolve(artifactDirectory, filename);
  const acknowledgement = await withTransientEdgeRetry(
    () => invokeCli([
      platform,
      'recording',
      'download',
      sessionId,
      recordingId,
      '--output',
      output,
      '--json',
    ], signal),
    signal,
  );
  assert.equal(acknowledgement.ok, true, 'CLI recording download omitted ok=true');
  assert.equal(acknowledgement.recordingId, recordingId);
  await writeJson('cli-recording-download.json', {
    ...acknowledgement,
    output: filename,
  });
  return await readArtifact(filename);
}

function assertRecordingIdentity(recording, sessionId, allowedStatuses) {
  assert.equal(recording.sessionId, sessionId, 'recording session did not match');
  assert.equal(recording.platform, platform, 'recording platform did not match');
  assert.equal(recording.contentType, 'video/mp4', 'recording content type did not match');
  assert.ok(allowedStatuses.includes(recording.status),
    `recording status ${recording.status} was not ${allowedStatuses.join(' or ')}`);
  assert.equal(typeof recording.id, 'string', 'recording omitted its ID');
}

async function collectSessionDiagnostics(simulator, sessions, recordings) {
  const diagnostics = [];
  if (!simulator) return diagnostics;
  for (const retained of sessions) {
    const item = {
      surface: retained.surface,
      sessionId: retained.session.id,
      session: null,
      recordings: [],
      failures: [],
    };
    try {
      item.session = sessionEvidence(
        await getSession(retained.surface, simulator, retained.session.id),
      );
    } catch (error) {
      item.failures.push({ operation: 'session', ...sanitizedFailure(asError(error)) });
    }
    for (const candidate of recordings.filter((value) => value.sessionId === retained.session.id)) {
      try {
        item.recordings.push(recordingEvidence(await getRecording(
          candidate.surface,
          simulator,
          candidate.sessionId,
          candidate.recording.id,
        )));
      } catch (error) {
        item.failures.push({ operation: 'recording', ...sanitizedFailure(asError(error)) });
      }
    }
    diagnostics.push(item);
  }
  return diagnostics;
}
