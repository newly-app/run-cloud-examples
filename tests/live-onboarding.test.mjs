import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'node:test';
import { Client } from '@run-cloud/sdk';

const execFileAsync = promisify(execFile);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const cliDirectory = join(testDirectory, 'node_modules', 'runcloud');
const cliManifest = JSON.parse(readFileSync(join(cliDirectory, 'package.json'), 'utf8'));
const cliEntry = join(cliDirectory, cliManifest.bin.runcloud);
const liveEnabled = process.env.RUN_CLOUD_LIVE_E2E === '1';

it(
  'runs one live SDK-to-CLI simulator lifecycle with guaranteed cleanup',
  { skip: liveEnabled ? false : 'Set RUN_CLOUD_LIVE_E2E=1 to create a metered session.', timeout: 180_000 },
  async () => {
    const apiKey = requiredEnv('RUN_CLOUD_API_KEY');
    const apiUrl = requiredEnv('RUN_CLOUD_API_URL');
    const platform = process.env.RUN_CLOUD_LIVE_PLATFORM ?? 'ios';
    assert.ok(['ios', 'android'].includes(platform), 'RUN_CLOUD_LIVE_PLATFORM must be ios or android');

    const cloud = new Client({ apiKey, apiUrl });
    let session;
    let released = false;

    try {
      const account = await cloud.account();
      assert.ok(account.meteringStatus ?? account.run_cloud_metering_status);

      session = await cloud.simulators.create({
        platform,
        displayName: `published-onboarding-e2e-${Date.now()}`,
        labels: { test: 'published-onboarding' },
        inactivityTimeout: '60s',
        hardTimeout: '2m',
      });
      assert.equal(session.platform, platform);
      assert.ok(session.id);

      const cliAccount = JSON.parse((await runCli(['account', '--json'], apiKey, apiUrl)).stdout);
      assert.ok(cliAccount);

      const fetched = JSON.parse(
        (await runCli([platform, 'get', session.id, '--json'], apiKey, apiUrl)).stdout,
      );
      assert.equal(fetched.id, session.id);

      await runCli(
        [platform, 'open-url', 'https://run.cloud', '--id', session.id, '--json'],
        apiKey,
        apiUrl,
      );
      await runCli([platform, 'delete', session.id, '--json'], apiKey, apiUrl);
      released = true;
    } finally {
      if (session && !released) {
        await cloud.simulators.delete(session.id, { platform }).catch(() => undefined);
      }
    }
  },
);

async function runCli(args, apiKey, apiUrl) {
  return await execFileAsync(process.execPath, [cliEntry, ...args], {
    timeout: 60_000,
    env: {
      ...process.env,
      RUN_CLOUD_API_KEY: apiKey,
      RUN_CLOUD_API_URL: apiUrl,
    },
  });
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live end-to-end test.`);
  return value;
}
