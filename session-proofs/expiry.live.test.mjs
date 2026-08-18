import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asError,
  createSession,
  failedStage,
  getSession,
  invokeCli,
  loadPublicSurface,
  platform,
  proofRun,
  releaseSession,
  sanitizedFailure,
  sessionEvidence,
  stage,
  throwIfAborted,
  usageSeconds,
  wait,
  writeJson,
} from './support.mjs';

const HARD_TIMEOUT = '90s';
const RELEASE_GRACE_MS = 30_000;
const EXEC_WS_TIMEOUT_MS = 20_000;
const USAGE_STABILITY_MS = 35_000;

test(
  `${platform} hard expiry releases the real session and stops public metered usage${platform === 'ios' ? ' while exec-ws rejects the expired JWT' : ''}`,
  { timeout: 10 * 60_000 },
  async (context) => {
    await runExpiryProof(context.signal);
  },
);

async function runExpiryProof(signal) {
  let cloud;
  let simulator;
  let session;
  let execCredential;
  let midStreamPromise;
  let operationError;
  const cleanup = [];
  const evidence = {
    schemaVersion: 1,
    feature: 'hard-expiry-metering-stop',
    platform,
    proofRun,
    samples: [],
  };

  try {
    ({ cloud, simulator } = await loadPublicSurface('hard-expiry-metering-stop', signal));
    session = await stage('sdk-session-create', async () =>
      await createSession('sdk', simulator, signal, {
        feature: 'hard-expiry-metering-stop',
        inactivityTimeout: '3m',
        hardTimeout: HARD_TIMEOUT,
      }));
    assert.equal(session.status, 'active');
    assert.equal(typeof session.expiresAt, 'string', 'session omitted expiresAt');
    assert.equal(typeof session.orgId, 'string', 'session omitted orgId');
    const expiresAtMs = Date.parse(session.expiresAt);
    assert.ok(Number.isFinite(expiresAtMs), 'session returned an invalid expiresAt');
    assert.ok(expiresAtMs > Date.now() + 20_000, 'session expiry left too little proof time');
    evidence.session = sessionEvidence(session);
    await writeJson('session-active.json', evidence.session);

    const cliActive = await stage('cli-observes-active-session', async () =>
      await invokeCli([platform, 'get', session.id, '--json'], signal));
    assert.equal(cliActive.status, 'active', 'CLI did not observe the active SDK-created session');
    evidence.samples.push({
      phase: 'active',
      capturedAt: new Date().toISOString(),
      sdkStatus: session.status,
      cliStatus: cliActive.status,
    });

    const meter = `simulator.${platform}`;
    const baselineCapturedAt = new Date();
    const baselineUsage = await stage('usage-baseline', async () =>
      usageSeconds(await cloud.usage({ orgId: session.orgId }), session.orgId, meter));
    evidence.usage = {
      orgId: session.orgId,
      meter,
      baselineCapturedAt: baselineCapturedAt.toISOString(),
      baselineSeconds: baselineUsage,
    };

    let execClaims = null;
    if (platform === 'ios') {
      const exec = await stage('exec-ws-valid-before-expiry', async () =>
        await fetchExecCredential(session, signal));
      execCredential = exec;
      execClaims = decodeJwtPayload(exec.credential);
      assert.ok(execClaims && typeof execClaims.exp === 'number',
        'the iOS exec credential is not an expiring JWT');
      assert.equal(execClaims.device, session.device,
        'the iOS exec credential is not bound to the leased device');
      assert.equal(execClaims.lease_id, session.leaseId,
        'the iOS exec credential is not bound to the leased lease');
      assert.ok(execClaims.exp * 1_000 <= expiresAtMs + 5_000,
        'the iOS exec credential outlives the session hard expiry');
      const sleepSeconds = Math.max(
        45,
        Math.ceil((execClaims.exp * 1_000 - Date.now()) / 1_000) + 15,
      );
      midStreamPromise = runExecWsCommands(
        exec.host,
        exec.credential,
        ['echo before-expiry', `sleep ${sleepSeconds}`, 'echo after-expiry'],
        signal,
        { timeoutMs: (sleepSeconds + 60) * 1_000 },
      ).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: asError(error) }),
      );
      evidence.exec = {
        jwtExpiresAt: new Date(execClaims.exp * 1_000).toISOString(),
        deviceBound: true,
        leaseBound: true,
      };
    }

    await stage('session-active-immediately-before-expiry', async () => {
      const target = expiresAtMs - 8_000;
      while (Date.now() < target) {
        throwIfAborted(signal);
        await wait(Math.min(10_000, Math.max(250, target - Date.now())), signal);
        if (Date.now() < target) await simulator.keepAlive(session.id);
      }
      const sdkActive = await simulator.get(session.id);
      const cliStillActive = await invokeCli([platform, 'get', session.id, '--json'], signal);
      assert.equal(sdkActive.status, 'active', 'SDK session ended before its stated expiresAt');
      assert.equal(cliStillActive.status, 'active', 'CLI session ended before its stated expiresAt');
      evidence.samples.push({
        phase: 'pre-expiry',
        capturedAt: new Date().toISOString(),
        sdkStatus: sdkActive.status,
        cliStatus: cliStillActive.status,
      });
    });

    const released = await stage('service-auto-releases-at-hard-expiry', async () =>
      await waitForReleased(simulator, session.id, expiresAtMs, signal, evidence.samples));
    assert.equal(released.status, 'released', 'SDK did not observe an automatic release');
    assert.equal(typeof released.releasedAt, 'string', 'released session omitted releasedAt');
    const releasedAtMs = Date.parse(released.releasedAt);
    assert.ok(releasedAtMs >= expiresAtMs - 5_000,
      'session released materially before its stated hard expiry');
    assert.ok(releasedAtMs <= expiresAtMs + RELEASE_GRACE_MS,
      'session did not release within the hard-expiry grace period');
    evidence.releasedSession = sessionEvidence(released);
    await writeJson('session-released.json', evidence.releasedSession);

    const cliReleased = await stage('cli-observes-auto-release', async () =>
      await invokeCli([platform, 'get', session.id, '--json'], signal));
    assert.equal(cliReleased.status, 'released', 'CLI did not observe the automatic release');
    evidence.samples.push({
      phase: 'released',
      capturedAt: new Date().toISOString(),
      sdkStatus: released.status,
      cliStatus: cliReleased.status,
    });

    evidence.expiryEnforcement = await stage('expired-public-operations-rejected', async () => {
      let sdkFailure;
      try {
        await simulator.screenshot(session.id, { signal });
        assert.fail('SDK captured a screenshot after the session hard expiry');
      } catch (error) {
        sdkFailure = asError(error);
        assert.equal(sdkFailure.status, 404,
          `SDK post-expiry screenshot failed with ${sdkFailure.status ?? 'no HTTP status'}`);
      }

      let cliFailure;
      try {
        await invokeCli([
          platform,
          'open-url',
          'https://example.com/?runcloud-proof=after-expiry',
          '--id',
          session.id,
          '--json',
        ], signal);
        assert.fail('CLI opened a URL after the session hard expiry');
      } catch (error) {
        cliFailure = asError(error);
        assert.match(cliFailure.message, /active.*session.*not found|404/i,
          'CLI post-expiry failure did not identify a terminal session');
      }

      return {
        sdkScreenshot: { rejected: true, failure: sanitizedFailure(sdkFailure) },
        cliOpenUrl: { rejected: true, failure: sanitizedFailure(cliFailure) },
      };
    });

    if (platform === 'ios') {
      const midStream = await stage('exec-ws-open-socket-dies-at-expiry', async () => {
        const result = await midStreamPromise;
        assert.equal(result.ok, true,
          `mid-stream exec channel errored: ${result.error?.message ?? 'unknown error'}`);
        assert.equal(result.value.authed, true, 'exec-ws rejected a still-valid credential');
        assert.equal(result.value.results[0]?.exitCode, 0,
          'the pre-expiry exec command did not run');
        assert.doesNotMatch(
          result.value.results.map((reply) => reply.stdout ?? '').join('\n'),
          /after-expiry/,
          'an already-open exec socket executed a command after JWT expiry',
        );
        const lastError = String(result.value.results.at(-1)?.error ?? '');
        assert.match(lastError, /expired|session.*ended|lease.*ended/i,
          'the post-expiry exec frame was not refused as expired or ended');
        return result.value;
      });
      evidence.exec.midStream = {
        authenticatedBeforeExpiry: midStream.authed,
        replyCount: midStream.results.length,
        postExpiryCommandExecuted: false,
        terminalError: String(midStream.results.at(-1)?.error ?? ''),
      };

      if (Date.now() <= execClaims.exp * 1_000) {
        await wait(execClaims.exp * 1_000 - Date.now() + 1_000, signal);
      }
      const expiredHandshake = await stage('exec-ws-expired-handshake-rejected', async () =>
        await runExecWsCommands(execCredential.host, execCredential.credential, ['true'], signal));
      assert.equal(expiredHandshake.authed, false,
        'exec-ws accepted the expired credential at handshake');
      evidence.exec.expiredHandshakeAuthenticated = false;
    }

    const stoppedUsage = await stage('public-meter-stops-at-expiry', async () => {
      const firstCapturedAt = new Date();
      const first = usageSeconds(
        await cloud.usage({ orgId: session.orgId }),
        session.orgId,
        meter,
      );
      await wait(USAGE_STABILITY_MS, signal);
      const secondCapturedAt = new Date();
      const second = usageSeconds(
        await cloud.usage({ orgId: session.orgId }),
        session.orgId,
        meter,
      );
      assert.equal(second, first,
        `${meter} usage kept increasing after the session hard expiry`);
      const expectedRemaining = Math.max(
        0,
        Math.floor((expiresAtMs - baselineCapturedAt.getTime()) / 1_000),
      );
      const delta = second - baselineUsage;
      assert.ok(delta >= Math.max(10, expectedRemaining - 20),
        `${meter} usage did not include the expiring session runtime`);
      assert.ok(delta <= expectedRemaining + 20,
        `${meter} usage exceeded the session's stated expiresAt`);
      return {
        firstCapturedAt: firstCapturedAt.toISOString(),
        firstSeconds: first,
        secondCapturedAt: secondCapturedAt.toISOString(),
        secondSeconds: second,
        observedDeltaSeconds: delta,
        expectedRemainingSeconds: expectedRemaining,
        stableForMs: USAGE_STABILITY_MS,
      };
    });
    evidence.usage = { ...evidence.usage, ...stoppedUsage };
    evidence.outcome = 'passed';
    await writeJson('result.json', evidence);
    cleanup.push({
      resource: 'session',
      id: session.id,
      outcome: 'auto-released',
      releasedAt: released.releasedAt,
    });
  } catch (error) {
    operationError = asError(error);
    await writeJson('failure.json', {
      ...evidence,
      stage: failedStage(),
      failure: sanitizedFailure(operationError),
      outcome: 'failed',
    });
  }

  if (session && simulator && !cleanup.some((item) => item.resource === 'session')) {
    try {
      const current = await getSession('sdk', simulator, session.id, signal);
      if (current.status === 'released') {
        cleanup.push({ resource: 'session', id: session.id, outcome: 'auto-released' });
      } else {
        const released = await releaseSession('sdk', simulator, session.id, signal);
        cleanup.push({
          resource: 'session',
          id: session.id,
          outcome: released.status === 'released' ? 'released-after-failure' : `unexpected-${released.status}`,
        });
      }
    } catch (error) {
      cleanup.push({
        resource: 'session',
        id: session.id,
        outcome: 'release-failed',
        failure: sanitizedFailure(asError(error)),
      });
    }
  }
  if (midStreamPromise) await midStreamPromise.catch(() => undefined);
  await writeJson('cleanup.json', {
    schemaVersion: 1,
    feature: 'hard-expiry-metering-stop',
    platform,
    proofRun,
    resources: cleanup,
    outcome: cleanup.some((item) => item.outcome === 'release-failed') ? 'failed' : 'complete',
  });

  const cleanupFailures = cleanup.filter((item) => item.outcome === 'release-failed');
  if (operationError && cleanupFailures.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupFailures.map((item) => new Error(JSON.stringify(item)))],
      `${platform} expiry proof failed and cleanup did not complete`,
      { cause: operationError },
    );
  }
  if (operationError) throw operationError;
  if (cleanupFailures.length > 0) {
    throw new Error(`${platform} expiry proof passed but cleanup did not complete`);
  }
}

async function waitForReleased(simulator, sessionId, expiresAtMs, signal, samples) {
  const deadline = expiresAtMs + RELEASE_GRACE_MS;
  if (Date.now() < expiresAtMs) await wait(expiresAtMs - Date.now(), signal);
  let session;
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    session = await simulator.get(sessionId);
    samples.push({
      phase: 'post-expiry-poll',
      capturedAt: new Date().toISOString(),
      sdkStatus: session.status,
    });
    if (session.status === 'released') return session;
    if (session.status === 'failed') {
      throw new Error(`session ${sessionId} failed instead of auto-releasing`);
    }
    await wait(1_000, signal);
  }
  throw new Error(
    `session ${sessionId} remained ${session?.status ?? 'unavailable'} `
      + `${RELEASE_GRACE_MS} ms after expiresAt`,
  );
}

async function fetchExecCredential(session, signal) {
  const location = parseSessionLocation(session);
  const url = new URL(`https://${location.host}/api`);
  url.searchParams.set('token', location.sessionToken);
  url.searchParams.set('device', location.device);
  const response = await fetch(url, { signal });
  assert.equal(response.ok, true, `preview config returned HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(typeof body.execToken, 'string', 'preview config omitted execToken');
  assert.ok(body.execToken.length > 0, 'preview config returned an empty execToken');
  return { host: location.host, credential: body.execToken };
}

function parseSessionLocation(session) {
  assert.equal(typeof session.url, 'string', 'session omitted its signed viewer URL');
  assert.equal(typeof session.device, 'string', 'session omitted its device');
  const url = new URL(session.url);
  const sessionToken = url.searchParams.get('token');
  assert.ok(sessionToken, 'session viewer URL omitted its signed token');
  return { host: url.host, device: session.device, sessionToken };
}

function decodeJwtPayload(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function runExecWsCommands(host, credential, commands, signal, options = {}) {
  return await new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`wss://${host}/exec-ws`);
    const results = [];
    let authed = false;
    let index = 0;
    let settled = false;
    const timer = setTimeout(() => {
      ws.close();
      finishError(new Error('exec-ws did not respond within the timeout'));
    }, options.timeoutMs ?? EXEC_WS_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      ws.close();
      resolvePromise(value);
    };
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      ws.close();
      reject(error);
    };
    const onAbort = () => finishError(asError(signal.reason ?? 'exec-ws proof cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });

    const sendNext = () => {
      index += 1;
      ws.send(JSON.stringify({ id: index, command: commands[index - 1] }));
    };
    ws.onopen = () => ws.send(JSON.stringify({ token: credential }));
    ws.onerror = () => {
      if (!authed) finish({ authed: false, results });
    };
    ws.onclose = () => finish({ authed, results });
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        finishError(new Error('exec-ws returned invalid JSON', { cause: error }));
        return;
      }
      if (!authed) {
        if (message.ready !== true) {
          finish({ authed: false, results });
          return;
        }
        authed = true;
        sendNext();
        return;
      }
      results.push(message);
      if (index >= commands.length || message.error) {
        finish({ authed: true, results });
        return;
      }
      sendNext();
    };
  });
}
