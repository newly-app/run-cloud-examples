import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDemo, parseOptions } from './demo.mjs';

describe('sdk-ios-android example', () => {
  it('documents and uses the public SDK for both simulator platforms', () => {
    const demo = readFileSync(new URL('./demo.mjs', import.meta.url), 'utf8');
    const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');

    assert.match(demo, /from '@run-cloud\/sdk'/);
    assert.match(demo, /platform: 'both'/);
    assert.match(demo, /cloud\.simulators\.create/);
    assert.match(demo, /cloud\.simulators\.openUrl/);
    assert.match(demo, /cloud\.simulators\.delete/);
    assert.match(demo, /cloud\.account/);
    assert.match(demo, /codec: options\.codec/);
    assert.match(readme, /--platform ios/);
    assert.match(readme, /--platform android/);
  });

  it('validates supported options', () => {
    assert.equal(parseOptions(['--platform', 'android', '--codec', 'webrtc', '--duration', '1']).platform, 'android');
    assert.equal(parseOptions(['--json', '--keep']).json, true);
    assert.throws(() => parseOptions(['--codec', 'avcc']), /--codec/);
  });

  it('runs the SDK lifecycle for iOS and Android with a mocked API', async () => {
    const requests = [];
    const fetch = async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });

      if (String(url).endsWith('/run-cloud/account')) {
        return json({ run_cloud_metering_status: 'active', run_cloud_balance_minutes: '100' });
      }
      if (String(url).endsWith('/run-cloud/ios') && init.method === 'POST') {
        return json(session('ios', init.body));
      }
      if (String(url).endsWith('/run-cloud/android') && init.method === 'POST') {
        return json(session('android', init.body));
      }
      if (String(url).includes('/open-url')) {
        return json({ ok: true });
      }
      if (init.method === 'DELETE') {
        return json({ status: 'released' });
      }
      throw new Error(`unexpected request: ${init.method} ${url}`);
    };

    await withProcessEnv({ RUN_CLOUD_API_KEY: 'rc_live_test' }, async () => {
      await withConsoleSilenced(async () => {
        await runDemo(['--platform', 'both', '--duration', '1', '--codec', 'webrtc', '--json'], { fetch });
      });
    });

    assert.deepEqual(requests.map((request) => [request.method, new URL(request.url).pathname]), [
      ['GET', '/run-cloud/account'],
      ['POST', '/run-cloud/ios'],
      ['POST', '/run-cloud/ios/ios-session/open-url'],
      ['POST', '/run-cloud/android'],
      ['POST', '/run-cloud/android/android-session/open-url'],
      ['DELETE', '/run-cloud/ios/ios-session'],
      ['DELETE', '/run-cloud/android/android-session'],
    ]);
    assert.deepEqual(requests[1].body, {
      displayName: 'sdk-ios-demo',
      labels: { demo: 'sdk-ios-android' },
      inactivityTimeout: '60s',
      hardTimeout: '10m',
      codec: 'webrtc',
    });
  });
});

function session(platform, body) {
  const options = JSON.parse(body);
  return {
    id: `${platform}-session`,
    platform,
    status: 'active',
    labels: options.labels,
    url: `https://${platform}.example.test`,
    baseUrl: `https://${platform}.example.test`,
    codec: options.codec,
    stream: { codec: options.codec, viewerCodec: options.codec, hostCodec: options.codec },
    checkedHosts: [],
    createdAt: new Date(0).toISOString(),
  };
}

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function withProcessEnv(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withConsoleSilenced(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    await callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
