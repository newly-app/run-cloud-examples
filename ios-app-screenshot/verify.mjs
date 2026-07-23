import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseOptions, runDemo } from './demo.mjs';

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

describe('ios-app-screenshot example', () => {
  it('documents the binary upload and screenshot SDK lifecycle', async () => {
    const demo = await readFile(new URL('./demo.mjs', import.meta.url), 'utf8');
    const readme = await readFile(new URL('./README.md', import.meta.url), 'utf8');

    assert.match(demo, /cloud\.assets\.upload/);
    assert.match(demo, /installAssets: \[asset\.id\]/);
    assert.match(demo, /cloud\.ios\.screenshot/);
    assert.match(demo, /cloud\.ios\.delete/);
    assert.match(demo, /cloud\.assets\.delete/);
    assert.match(readme, /multipart/i);
    assert.match(readme, /raw\s+PNG bytes/i);
  });

  it('validates options', () => {
    assert.equal(parseOptions(['--settle-ms', '0']).settleMs, 0);
    assert.match(parseOptions(['--output', 'proof.png']).output, /proof\.png$/);
    assert.throws(() => parseOptions(['--settle-ms', '-1']), /--settle-ms/);
    assert.throws(() => parseOptions(['--unknown']), /Unknown option/);
  });

  it('uploads an app, installs it, captures a PNG, and cleans up', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'run-cloud-app-screenshot-'));
    const appPath = join(directory, 'Example.app.tar.gz');
    const outputPath = join(directory, 'proof.png');
    const requests = [];
    await writeFile(appPath, 'real-app-archive');

    const fetch = async (url, init = {}) => {
      const path = new URL(String(url)).pathname;
      requests.push({ method: init.method, path, body: init.body });

      if (path === '/run-cloud/assets' && init.method === 'POST') {
        assert.ok(init.body instanceof FormData);
        assert.equal(init.body.get('file').type, 'application/gzip');
        return json(asset());
      }
      if (path === '/run-cloud/ios' && init.method === 'POST') {
        const body = JSON.parse(init.body);
        assert.deepEqual(body.installAssets, ['asset-1']);
        return json(session(), 201);
      }
      if (path === '/run-cloud/ios/session-1/screenshot' && init.method === 'GET') {
        return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (path === '/run-cloud/ios/session-1' && init.method === 'DELETE') {
        return json({ ...session(), status: 'released' });
      }
      if (path === '/run-cloud/assets/asset-1' && init.method === 'DELETE') {
        return json({ deleted: true });
      }
      throw new Error(`Unexpected request: ${init.method} ${path}`);
    };

    try {
      const result = await withConsoleSilenced(() =>
        runDemo(
          ['--app', appPath, '--output', outputPath, '--settle-ms', '0'],
          {
            clientOptions: {
              apiKey: 'rc_example_test',
              apiUrl: 'https://api.example.test',
              fetch,
            },
          },
        ),
      );

      assert.equal(result.byteSize, PNG.byteLength);
      assert.deepEqual(new Uint8Array(await readFile(outputPath)), PNG);
      assert.deepEqual(
        requests.map(({ method, path }) => [method, path]),
        [
          ['POST', '/run-cloud/assets'],
          ['POST', '/run-cloud/ios'],
          ['GET', '/run-cloud/ios/session-1/screenshot'],
          ['DELETE', '/run-cloud/ios/session-1'],
          ['DELETE', '/run-cloud/assets/asset-1'],
        ],
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function asset() {
  return {
    id: 'asset-1',
    name: 'example',
    filename: 'RunCloudProof.app.tar.gz',
    contentType: 'application/gzip',
    byteSize: 16,
    createdAt: new Date(0).toISOString(),
  };
}

function session() {
  return {
    id: 'session-1',
    platform: 'ios',
    status: 'active',
    labels: {},
    url: 'https://viewer.example.test',
    baseUrl: 'https://viewer.example.test',
    codec: 'mjpeg',
    stream: { codec: 'mjpeg', viewerCodec: 'mjpeg', hostCodec: 'mjpeg' },
    checkedHosts: [],
    createdAt: new Date(0).toISOString(),
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function withConsoleSilenced(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
