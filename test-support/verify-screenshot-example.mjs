import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { browserCommand, parseScreenshotOptions } from '../lib/screenshot-demo.mjs';
import { inspectPng } from '../lib/png.mjs';
import { pngFixture } from './png-fixture.mjs';

export function verifyScreenshotExample({
  platform,
  runDemo,
  artifactContentType,
  artifactFilename,
}) {
  describe(`${platform}-app-screenshot example`, () => {
    it('accepts mirrored automation options and rejects unbounded waits', () => {
      const options = parseScreenshotOptions(
        ['--json', '--open', '--settle-ms', '0', '--ready-timeout-ms', '1000'],
        'proof.png',
      );
      assert.equal(options.json, true);
      assert.equal(options.open, true);
      assert.equal(options.settleMs, 0);
      assert.equal(options.readyTimeoutMs, 1_000);
      assert.throws(
        () => parseScreenshotOptions(['--ready-timeout-ms', '999'], 'proof.png'),
        /between 1000 and 300000/,
      );
      assert.throws(
        () => parseScreenshotOptions(['--settle-ms', '15001'], 'proof.png'),
        /between 0 and 15000/,
      );
      assert.throws(
        () => parseScreenshotOptions(['--unknown'], 'proof.png'),
        /Unknown option/,
      );
    });

    it('uploads, waits for active, captures validated pixels, emits JSON, and cleans up in order', async () => {
      const fixture = await setupFixture(platform);
      const events = [];
      const fake = fakeCloud(platform, events, { initialStatus: 'provisioning' });
      let clock = 1_000;

      try {
        const { result, stdout, stderr } = await captureConsole(() =>
          runDemo(
            [
              '--app', fixture.appPath,
              '--output', fixture.outputPath,
              '--ready-timeout-ms', '3000',
              '--settle-ms', '25',
              '--json',
            ],
            {
              createClient: () => fake.cloud,
              now: () => clock,
              sleep: async (milliseconds) => {
                events.push(`sleep:${milliseconds}`);
                clock += milliseconds;
              },
            },
          ),
        );

        assert.deepEqual(result, {
          platform,
          sessionId: `${platform}-session`,
          assetId: `${platform}-asset`,
          output: fixture.outputPath,
          byteSize: fake.png.byteLength,
          width: 3,
          height: 2,
          cleanup: { session: 'released', asset: 'deleted' },
        });
        assert.deepEqual(JSON.parse(stdout.trim()), result);
        assert.match(stderr, /Uploading/);
        assert.match(stderr, /Capturing/);
        assert.deepEqual(await readFile(fixture.outputPath), fake.png);
        assert.equal(fake.upload.type, artifactContentType);
        assert.equal(fake.uploadOptions.filename, artifactFilename);
        assert.deepEqual(fake.createOptions.tags, { example: 'app-screenshot', platform });
        assert.equal('labels' in fake.createOptions, false);
        assert.deepEqual(fake.createOptions.installAssets, [`${platform}-asset`]);
        assert.equal(fake.createOptions.inactivityTimeout, '60s');
        assert.equal(fake.createOptions.hardTimeout, '10m');
        assert.equal(fake.screenshotSessionId, `${platform}-session`);
        assert.deepEqual(fake.getSessionIds, [`${platform}-session`]);
        assert.equal(fake.deletedSessionId, `${platform}-session`);
        assert.equal(fake.deletedAssetId, `${platform}-asset`);
        assert.deepEqual(events, [
          'asset:upload',
          'session:create',
          'sleep:1000',
          'session:get',
          'sleep:25',
          'session:screenshot',
          'session:delete',
          'asset:delete',
        ]);
      } finally {
        await fixture.remove();
      }
    });

    it('opens the refreshed ready-session URL without exposing it in JSON', async () => {
      const fixture = await setupFixture(platform);
      const events = [];
      const fake = fakeCloud(platform, events, { initialStatus: 'provisioning' });
      let opened;
      let clock = 0;
      try {
        const { stdout } = await captureConsole(() =>
          runDemo(
            ['--app', fixture.appPath, '--output', fixture.outputPath, '--open', '--settle-ms', '0', '--json'],
            {
              createClient: () => fake.cloud,
              open: async (url) => {
                opened = url;
                events.push('browser:open');
              },
              now: () => clock,
              sleep: async (milliseconds) => {
                clock += milliseconds;
              },
            },
          ),
        );
        assert.equal(opened, `https://${platform}.viewer.example.test/signed`);
        assert.doesNotMatch(stdout, /viewer\.example/);
        assert.ok(events.indexOf('session:get') < events.indexOf('browser:open'));
      } finally {
        await fixture.remove();
      }
    });

    it('uses the installed SDK transport for the complete platform screenshot lifecycle', async () => {
      const fixture = await setupFixture(platform);
      const png = pngFixture({ width: 3, height: 2 });
      const requests = [];
      const fetch = async (url, init = {}) => {
        const parsedUrl = new URL(String(url));
        const path = parsedUrl.pathname;
        const headers = new Headers(init.headers);
        requests.push({
          url: String(url),
          path,
          method: init.method,
          authorization: headers.get('authorization'),
          body: init.body,
        });
        if (path === '/run-cloud/assets/uploads' && init.method === 'POST') {
          const body = JSON.parse(init.body);
          assert.equal(body.contentType, artifactContentType);
          assert.equal(body.filename, artifactFilename);
          assert.equal(body.byteSize, 10);
          assert.match(body.checksum.value, /^[0-9a-f]{32}$/);
          return json({
            asset: { ...assetResponse(platform), status: 'uploading' },
            upload: {
              url: `https://storage.example.test/${platform}-asset`,
              headers: { 'content-type': artifactContentType },
              finalizeUrl: `/run-cloud/assets/${platform}-asset/finalize`,
            },
            reused: false,
            maxConcurrency: 6,
          }, 201);
        }
        if (parsedUrl.origin === 'https://storage.example.test') {
          assert.equal(init.method, 'PUT');
          assert.ok(init.body instanceof Blob);
          assert.equal(init.body.type, artifactContentType);
          assert.equal(headers.get('content-type'), artifactContentType);
          assert.equal(headers.get('authorization'), null);
          return new Response(null, { status: 200 });
        }
        if (path === `/run-cloud/assets/${platform}-asset/finalize`) {
          const body = JSON.parse(init.body);
          assert.match(body.checksum.value, /^[0-9a-f]{32}$/);
          assert.equal(typeof body.durationMs, 'number');
          return json({ asset: assetResponse(platform) });
        }
        if (path === `/run-cloud/${platform}` && init.method === 'POST') {
          const body = JSON.parse(init.body);
          assert.deepEqual(body.tags, { example: 'app-screenshot', platform });
          assert.equal('labels' in body, false);
          assert.deepEqual(body.installAssets, [`${platform}-asset`]);
          return json(sessionResponse(platform), 201);
        }
        if (path === `/run-cloud/${platform}/${platform}-session/screenshot`) {
          return new Response(png, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          });
        }
        if (path === `/run-cloud/${platform}/${platform}-session` && init.method === 'DELETE') {
          return json({ ...sessionResponse(platform), status: 'released' });
        }
        if (path === `/run-cloud/assets/${platform}-asset` && init.method === 'DELETE') {
          return json({ deleted: true });
        }
        throw new Error(`Unexpected request: ${init.method} ${path}`);
      };

      try {
        const { result } = await captureConsole(() =>
          runDemo(
            ['--app', fixture.appPath, '--output', fixture.outputPath, '--settle-ms', '0'],
            {
              clientOptions: {
                apiKey: 'rc_example_transport_test',
                apiUrl: 'https://api.example.test',
                fetch,
              },
              now: () => 42,
            },
          ),
        );
        assert.equal(result.platform, platform);
        assert.deepEqual(
          requests.map(({ method, path }) => [method, path]),
          [
            ['POST', '/run-cloud/assets/uploads'],
            ['PUT', `/${platform}-asset`],
            ['POST', `/run-cloud/assets/${platform}-asset/finalize`],
            ['POST', `/run-cloud/${platform}`],
            ['GET', `/run-cloud/${platform}/${platform}-session/screenshot`],
            ['DELETE', `/run-cloud/${platform}/${platform}-session`],
            ['DELETE', `/run-cloud/assets/${platform}-asset`],
          ],
        );
        assert.ok(
          requests
            .filter(({ url }) => url.startsWith('https://api.example.test/'))
            .every(({ authorization }) => authorization === 'Bearer rc_example_transport_test'),
        );
      } finally {
        await fixture.remove();
      }
    });

    it('rejects blank PNG pixels and still releases the session before the asset', async () => {
      const fixture = await setupFixture(platform);
      const events = [];
      const fake = fakeCloud(platform, events, { png: pngFixture({ blank: true }) });
      try {
        await assert.rejects(
          () => captureConsole(() => runDemo(
            ['--app', fixture.appPath, '--output', fixture.outputPath, '--settle-ms', '0'],
            { createClient: () => fake.cloud },
          )),
          /blank/,
        );
        assert.deepEqual(events.slice(-2), ['session:delete', 'asset:delete']);
        await assert.rejects(() => readFile(fixture.outputPath), /ENOENT/);
      } finally {
        await fixture.remove();
      }
    });

    it('turns cancellation into an error and cleans up before exiting', async () => {
      const fixture = await setupFixture(platform);
      const events = [];
      const fake = fakeCloud(platform, events);
      const controller = new AbortController();
      try {
        await assert.rejects(
          () => captureConsole(() => runDemo(
            ['--app', fixture.appPath, '--output', fixture.outputPath, '--settle-ms', '25'],
            {
              createClient: () => fake.cloud,
              signal: controller.signal,
              sleep: async () => controller.abort(new Error('test cancellation')),
            },
          )),
          /test cancellation/,
        );
        assert.equal(events.includes('session:screenshot'), false);
        assert.deepEqual(events.slice(-2), ['session:delete', 'asset:delete']);
      } finally {
        await fixture.remove();
      }
    });

    it('times out a provisioning session and reports both ordered cleanup failures', async () => {
      const fixture = await setupFixture(platform);
      const events = [];
      const fake = fakeCloud(platform, events, {
        initialStatus: 'provisioning',
        getStatus: 'provisioning',
        deleteSessionError: new Error('release unavailable'),
        deleteAssetError: new Error('asset unavailable'),
      });
      let clock = 0;

      try {
        await assert.rejects(
          () => captureConsole(() => runDemo(
            [
              '--app', fixture.appPath,
              '--output', fixture.outputPath,
              '--ready-timeout-ms', '1000',
              '--settle-ms', '0',
            ],
            {
              createClient: () => fake.cloud,
              now: () => clock,
              sleep: async (milliseconds) => {
                clock += milliseconds;
              },
            },
          )),
          (error) => {
            assert.ok(error instanceof AggregateError);
            assert.match(error.message, /not active within 1000 ms/);
            assert.match(error.message, /session .*release unavailable/);
            assert.match(error.message, /asset .*asset unavailable/);
            return true;
          },
        );
        assert.deepEqual(events.slice(-2), ['session:delete', 'asset:delete']);
      } finally {
        await fixture.remove();
      }
    });

    it('surfaces a cleanup failure even after a screenshot was saved', async () => {
      const fixture = await setupFixture(platform);
      const events = [];
      const fake = fakeCloud(platform, events, {
        deleteSessionError: new Error('release rejected'),
      });
      try {
        await assert.rejects(
          () => captureConsole(() => runDemo(
            ['--app', fixture.appPath, '--output', fixture.outputPath, '--settle-ms', '0'],
            { createClient: () => fake.cloud },
          )),
          /Screenshot was saved, but cleanup failed: session .*release rejected/,
        );
        assert.deepEqual(await readFile(fixture.outputPath), fake.png);
        assert.deepEqual(events.slice(-2), ['session:delete', 'asset:delete']);
      } finally {
        await fixture.remove();
      }
    });

    it('fails actionably when the installed SDK has no platform screenshot method', async () => {
      await assert.rejects(
        () => captureConsole(() => runDemo([], {
          createClient: () => ({ [platform]: {}, assets: {} }),
        })),
        new RegExp(`does not support ${platform} screenshots`),
      );
    });
  });
}

describe('shared screenshot validation and browser support', () => {
  it('validates PNG dimensions, checksums, and nonblank decoded pixels', () => {
    const png = pngFixture({ width: 4, height: 3 });
    assert.deepEqual(inspectPng(png), { width: 4, height: 3 });
    const corrupted = Buffer.from(png);
    corrupted[corrupted.length - 1] ^= 0xff;
    assert.throws(() => inspectPng(corrupted), /checksum/);
    assert.throws(() => inspectPng(Buffer.from('not png')), /not a PNG/);
  });

  it('selects native browser openers without shell interpolation', () => {
    assert.deepEqual(browserCommand('https://example.test/a?b=1', 'darwin'), {
      file: 'open',
      args: ['https://example.test/a?b=1'],
    });
    assert.deepEqual(browserCommand('https://example.test/a?b=1', 'linux'), {
      file: 'xdg-open',
      args: ['https://example.test/a?b=1'],
    });
    assert.deepEqual(browserCommand('https://example.test/a?b=1', 'win32'), {
      file: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', 'https://example.test/a?b=1'],
    });
  });
});

function fakeCloud(platform, events, options = {}) {
  const png = options.png ?? pngFixture({ width: 3, height: 2 });
  const result = { png };
  const session = (status, ready = false) => ({
    id: `${platform}-session`,
    platform,
    status,
    tags: {},
    url: ready ? `https://${platform}.viewer.example.test/signed` : null,
    createdAt: new Date(0).toISOString(),
  });
  const client = {
    async create(createOptions) {
      events.push('session:create');
      result.createOptions = createOptions;
      return session(options.initialStatus ?? 'active', options.initialStatus !== 'provisioning');
    },
    async get(sessionId) {
      events.push('session:get');
      result.getSessionIds ??= [];
      result.getSessionIds.push(sessionId);
      const status = options.getStatus ?? 'active';
      return session(status, status === 'active');
    },
    async screenshot(sessionId) {
      events.push('session:screenshot');
      result.screenshotSessionId = sessionId;
      return png;
    },
    async delete(sessionId) {
      events.push('session:delete');
      result.deletedSessionId = sessionId;
      if (options.deleteSessionError) throw options.deleteSessionError;
      return session('released');
    },
  };
  result.cloud = {
    [platform]: client,
    assets: {
      async upload(upload, uploadOptions) {
        events.push('asset:upload');
        result.upload = upload;
        result.uploadOptions = uploadOptions;
        return { id: `${platform}-asset` };
      },
      async delete(assetId) {
        events.push('asset:delete');
        result.deletedAssetId = assetId;
        if (options.deleteAssetError) throw options.deleteAssetError;
        return { deleted: true };
      },
    },
  };
  return result;
}

function assetResponse(platform) {
  return {
    id: `${platform}-asset`,
    name: `${platform} proof`,
    filename: platform === 'ios' ? 'RunCloudProof.app.tar.gz' : 'RunCloudProof.apk',
    contentType: platform === 'ios'
      ? 'application/gzip'
      : 'application/vnd.android.package-archive',
    byteSize: 10,
    status: 'ready',
    createdAt: new Date(0).toISOString(),
  };
}

function sessionResponse(platform) {
  return {
    id: `${platform}-session`,
    platform,
    status: 'active',
    tags: { example: 'app-screenshot', platform },
    url: `https://${platform}.viewer.example.test/signed`,
    codec: 'mjpeg',
    stream: { codec: 'mjpeg', viewerCodec: 'mjpeg', hostCodec: 'mjpeg' },
    createdAt: new Date(0).toISOString(),
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function setupFixture(platform) {
  const directory = await mkdtemp(join(tmpdir(), `run-cloud-${platform}-screenshot-`));
  const appPath = join(directory, platform === 'ios' ? 'App.app.tar.gz' : 'app.apk');
  const outputPath = join(directory, 'proof.png');
  await writeFile(appPath, 'native-app');
  return {
    appPath,
    outputPath,
    remove: async () => rm(directory, { recursive: true, force: true }),
  };
}

async function captureConsole(callback) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values) => stdout.push(values.join(' '));
  console.error = (...values) => stderr.push(values.join(' '));
  try {
    return {
      result: await callback(),
      stdout: `${stdout.join('\n')}${stdout.length ? '\n' : ''}`,
      stderr: `${stderr.join('\n')}${stderr.length ? '\n' : ''}`,
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
