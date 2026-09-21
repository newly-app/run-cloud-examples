import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { Client } from '@run-cloud/sdk';
import { startConnector } from './connector.mjs';
import { connect } from './client.mjs';

if (process.env.RUN_CLOUD_REGISTRATION_E2E !== '1') {
  throw new Error('Set RUN_CLOUD_REGISTRATION_E2E=1 to authorize a fresh account and verification email');
}
const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'runcloud-registration-'));
const env = { ...process.env, RUN_CLOUD_REGISTRATION_STATE_DIR: directory };
const report = { runId: randomUUID(), startedAt: new Date().toISOString(),
  target: env.RUN_CLOUD_API_URL ?? 'https://api.run.cloud',
  framework: '@a2a-js/sdk@1.2.0', manualInputDuringRun: false, checks: {},
  limitations: ['Loopback A2A adapter, deployed run.cloud upstream', 'Registration/auth only; payment is a separate proof'] };
let server;
let stage = 'request-email';
const signup = action => exec(process.execPath, [fileURLToPath(new URL('./signup.mjs', import.meta.url)), action],
  { env, timeout: 60_000, maxBuffer: 64 * 1024 });
try {
  await signup('start');
  stage = 'read-mail-and-register';
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { await signup('finish'); break; }
    catch (error) {
      if (!error.stderr?.includes('Verification email not delivered yet') || Date.now() >= deadline) throw error;
      await setTimeout(3000);
    }
  }
  const state = JSON.parse(await readFile(join(directory, 'signup.json'), 'utf8'));
  assert.equal(state.freshSignup, true);
  report.checks.freshSignup = true;
  report.checks.realEmailCodeRetrievedViaImap = true;
  report.checks.organizationCreated = Boolean(state.orgId);
  stage = 'sdk-cli-authentication';
  const cloud = new Client({ apiKey: state.apiKey, apiUrl: state.apiUrl });
  const credential = await cloud.credential();
  assert.equal(credential.runCloud, true);
  assert.ok(credential.orgs.includes(state.orgId));
  report.checks.sdkAuthentication = true;
  const cli = await exec('runcloud', ['account', '--json'], { timeout: 30_000,
    env: { ...env, RUN_CLOUD_API_KEY: state.apiKey, RUN_CLOUD_API_TOKEN: state.apiKey, RUN_CLOUD_API_URL: state.apiUrl } });
  const cliAccount = JSON.parse(cli.stdout);
  assert.equal(cliAccount.userId, credential.userId);
  assert.equal(cliAccount.runCloud, true);
  report.checks.cliAuthentication = true;
  stage = 'a2a-authentication';
  server = await startConnector({ apiUrl: state.apiUrl });
  const card = await (await fetch(`${server.baseUrl}/.well-known/agent-card.json`)).json();
  assert.equal(card.supportedInterfaces[0].protocolVersion, '1.0');
  report.checks.a2aDiscovery = true;
  for (const authorization of [undefined, 'Bearer rc_live_invalid_registration_proof']) {
    const rejected = await fetch(`${server.baseUrl}/a2a`, { method: 'POST',
      headers: authorization ? { Authorization: authorization } : {} });
    assert.equal(rejected.status, 401);
  }
  report.checks.missingAndInvalidKeysRejected = true;
  const agent = await connect(server.baseUrl, state.apiKey);
  assert.equal((await agent({ operation: 'account' })).authenticated, true);
  report.checks.a2aAuthentication = true;
  await agent({ operation: 'usage', orgId: state.orgId });
  report.checks.a2aAccountScopedRead = true;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { stage, type: error.name };
  process.exitCode = 1;
} finally {
  await server?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(directory, 'proof.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...report, privateEvidenceDirectory: directory }, null, 2));
}
