import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import { Client } from '@run-cloud/sdk';

const execFileAsync = promisify(execFile);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = dirname(testDirectory);
const sdkDirectory = join(testDirectory, 'node_modules', '@run-cloud', 'sdk');
const cliDirectory = join(testDirectory, 'node_modules', 'runcloud');
const sdkManifest = readJson(join(sdkDirectory, 'package.json'));
const cliManifest = readJson(join(cliDirectory, 'package.json'));
const cliEntry = join(cliDirectory, cliManifest.bin.runcloud);

describe('published onboarding artifacts', () => {
  it('installs the released SDK and CLI versions from npm', () => {
    assert.equal(sdkManifest.version, '0.4.0');
    assert.equal(cliManifest.version, '0.1.6');
  });

  it('resolves the public documentation used by onboarding', async () => {
    const pages = [
      ['https://docs.run.cloud/cli/quickstart', /The CLI accepts either/],
      ['https://docs.run.cloud/cli/typescript-sdk', /@run-cloud\/sdk/],
    ];

    for (const [url, expected] of pages) {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200, `${url} returned ${response.status}`);
      assert.match(await response.text(), expected);
    }

    const sourceSkill = readFileSync(
      join(repositoryDirectory, 'skills', 'run-cloud-ios-simulator', 'SKILL.md'),
      'utf8',
    );
    assert.match(sourceSkill, /version: 0\.6\.0/);
    assert.match(sourceSkill, /https:\/\/docs\.run\.cloud\/cli\/typescript-sdk/);
    assert.doesNotMatch(sourceSkill, /https:\/\/run\.cloud\/cli\/typescript-sdk/);
  });

  it('runs the documented SDK lifecycle from the published package', async () => {
    const requests = [];
    const fetch = async (url, init = {}) => {
      const request = {
        url: String(url),
        method: init.method,
        authorization: init.headers?.Authorization,
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);

      if (request.url.endsWith('/run-cloud/account')) {
        return json({ run_cloud_metering_status: 'active', run_cloud_balance_minutes: '100' });
      }
      if (request.url.endsWith('/run-cloud/ios') && request.method === 'POST') {
        return json(session('ios'));
      }
      if (request.url.endsWith('/run-cloud/android') && request.method === 'POST') {
        return json(session('android'));
      }
      if (request.url.endsWith('/open-url')) return json({ ok: true });
      if (request.method === 'DELETE') return json({ status: 'released' });
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    };

    const cloud = new Client({
      apiKey: 'rc_published_test',
      apiUrl: 'https://api.example.test',
      fetch,
    });

    const account = await cloud.account();
    assert.equal(account.meteringStatus, 'active');
    assert.equal(account.balanceMinutes, '100');

    for (const platform of ['ios', 'android']) {
      const created = await cloud.simulators.create({ platform, inactivityTimeout: '60s' });
      await cloud.simulators.openUrl(created.id, 'https://run.cloud', { platform });
      await cloud.simulators.delete(created.id, { platform });
    }

    assert.deepEqual(requests.map(({ method, url }) => [method, new URL(url).pathname]), [
      ['GET', '/run-cloud/account'],
      ['POST', '/run-cloud/ios'],
      ['POST', '/run-cloud/ios/ios-session/open-url'],
      ['DELETE', '/run-cloud/ios/ios-session'],
      ['POST', '/run-cloud/android'],
      ['POST', '/run-cloud/android/android-session/open-url'],
      ['DELETE', '/run-cloud/android/android-session'],
    ]);
    assert.ok(requests.every(({ authorization }) => authorization === 'Bearer rc_published_test'));
  });

  it('installs the current agent skill from the published CLI', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'run-cloud-onboarding-'));
    try {
      const version = await runCli(['--version'], workspace);
      assert.equal(version.stdout.trim(), '0.1.6');

      await runCli(
        ['skills', 'install', '--agents', 'codex', '--scope', 'project', '--json'],
        workspace,
      );
      const skill = readFileSync(
        join(workspace, '.codex', 'skills', 'run-cloud-ios-simulator', 'SKILL.md'),
        'utf8',
      );
      assert.match(skill, /version: 0\.5\.1/);
      assert.match(skill, /RUN_CLOUD_API_KEY.*RUN_CLOUD_API_URL/s);
      assert.match(skill, /Do not require both a saved login and an API key/);
      assert.match(skill, /ios-simulator:session-restart-requested/);
      assert.match(skill, /https:\/\/docs\.run\.cloud\/cli\/typescript-sdk/);
      assert.doesNotMatch(skill, /https:\/\/run\.cloud\/cli\/typescript-sdk/);
      assert.doesNotMatch(skill, /@run-cloud\/sdk\/compat\//);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('runs the published CLI lifecycle with API-key environment authentication', async () => {
    const requests = [];
    const server = createServer(async (request, response) => {
      const body = await readRequestBody(request);
      requests.push({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
        body: body ? JSON.parse(body) : undefined,
      });

      if (request.url === '/run-cloud/account') {
        return sendJson(response, { run_cloud_metering_status: 'active' });
      }
      if (request.url === '/run-cloud/ios' && request.method === 'POST') {
        return sendJson(response, session('ios'));
      }
      if (request.url === '/run-cloud/ios/ios-session' && request.method === 'GET') {
        return sendJson(response, session('ios'));
      }
      if (request.url === '/run-cloud/ios/ios-session/open-url') {
        return sendJson(response, { ok: true });
      }
      if (request.url === '/run-cloud/ios/ios-session' && request.method === 'DELETE') {
        return sendJson(response, { status: 'released' });
      }
      response.writeHead(404).end();
    });
    const apiUrl = await listen(server);
    const workspace = mkdtempSync(join(tmpdir(), 'run-cloud-cli-lifecycle-'));
    const env = {
      RUN_CLOUD_API_KEY: 'rc_live_cli_test',
      RUN_CLOUD_API_URL: apiUrl,
    };

    try {
      const account = JSON.parse((await runCli(['account', '--json'], workspace, { env })).stdout);
      assert.equal(account.run_cloud_metering_status, 'active');

      const created = JSON.parse(
        (
          await runCli(
            ['ios', 'create', '--inactivity-timeout', '60s', '--json'],
            workspace,
            { env },
          )
        ).stdout,
      );
      assert.equal(created.id, 'ios-session');

      await runCli(['ios', 'get', created.id, '--json'], workspace, { env });
      await runCli(
        ['ios', 'open-url', 'https://run.cloud', '--id', created.id, '--json'],
        workspace,
        { env },
      );
      await runCli(['ios', 'delete', created.id, '--json'], workspace, { env });
    } finally {
      await close(server);
      rmSync(workspace, { recursive: true, force: true });
    }

    assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
      ['GET', '/run-cloud/account'],
      ['POST', '/run-cloud/ios'],
      ['GET', '/run-cloud/ios/ios-session'],
      ['POST', '/run-cloud/ios/ios-session/open-url'],
      ['DELETE', '/run-cloud/ios/ios-session'],
    ]);
    assert.ok(requests.every(({ authorization }) => authorization === 'Bearer rc_live_cli_test'));
    assert.equal(requests[1].body.inactivityTimeout, '60s');
  });

  for (const name of ['eight-device-mosaic', 'live-camera-relay']) {
    it(`scaffolds and verifies the published ${name} demo`, async () => {
      const workspace = mkdtempSync(join(tmpdir(), `run-cloud-${name}-`));
      const demoDirectory = join(workspace, 'demo');
      try {
        await runCli(['demo', 'init', name, demoDirectory, '--json'], workspace);
        await execFileAsync(process.execPath, ['--test', 'verify.mjs'], {
          cwd: demoDirectory,
          timeout: 30_000,
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  }
});

async function runCli(args, cwd, options = {}) {
  return await execFileAsync(process.execPath, [cliEntry, ...args], {
    cwd,
    timeout: 30_000,
    env: {
      ...process.env,
      RUN_CLOUD_HOME: join(cwd, '.run-cloud'),
      ...options.env,
    },
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function session(platform) {
  return {
    id: `${platform}-session`,
    platform,
    status: 'active',
    url: `https://${platform}.example.test`,
    baseUrl: `https://${platform}.example.test`,
    checkedHosts: [],
    createdAt: new Date(0).toISOString(),
  };
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
