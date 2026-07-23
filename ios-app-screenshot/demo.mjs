import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@run-cloud/sdk';
import { buildApp } from './build-app.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function parseOptions(args) {
  const options = {
    app: null,
    output: resolve('screenshots', 'run-cloud-proof.png'),
    open: false,
    settleMs: 2_000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--open') {
      options.open = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--app' || argument === '--output' || argument === '--settle-ms') {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === '--app') options.app = resolve(value);
      if (argument === '--output') options.output = resolve(value);
      if (argument === '--settle-ms') options.settleMs = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (!Number.isInteger(options.settleMs) || options.settleMs < 0 || options.settleMs > 15_000) {
    throw new Error('--settle-ms must be between 0 and 15000.');
  }
  return options;
}

function openBrowser(url) {
  const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

function isPng(bytes) {
  return Buffer.from(bytes).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function cleanup(cloud, session, asset) {
  const releases = [];
  if (session) releases.push(['session', cloud.ios.delete(session.id)]);
  if (asset) releases.push(['asset', cloud.assets.delete(asset.id)]);

  const results = await Promise.allSettled(releases.map(([, promise]) => promise));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Could not delete ${releases[index][0]}: ${result.reason}`);
    }
  });
}

export async function runDemo(
  args = process.argv.slice(2),
  { clientOptions = {}, build = buildApp, sleep = wait } = {},
) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('Usage: npm run demo -- [--open] [--app path/to/App.tar.gz] [--output screenshot.png] [--settle-ms 2000]');
    return null;
  }

  const cloud = new Client(clientOptions);
  let asset;
  let session;

  try {
    const archivePath = options.app ?? (await build()).archivePath;
    const archive = await readFile(archivePath);

    console.log(`Uploading ${archivePath}...`);
    asset = await cloud.assets.upload(
      new Blob([archive], { type: 'application/gzip' }),
      {
        name: `ios-app-screenshot-${Date.now()}`,
        filename: 'RunCloudProof.app.tar.gz',
      },
    );

    console.log('Creating a simulator and installing the uploaded app...');
    session = await cloud.ios.create({
      displayName: 'Real app screenshot',
      labels: { demo: 'ios-app-screenshot' },
      installAssets: [asset.id],
      inactivityTimeout: '60s',
      hardTimeout: '5m',
    });

    if (options.open && session.url) openBrowser(session.url);
    if (options.settleMs > 0) await sleep(options.settleMs);

    console.log('Capturing the simulator screen...');
    const screenshot = await cloud.ios.screenshot(session.id);
    if (!isPng(screenshot)) throw new Error('Screenshot response was not a PNG.');

    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, screenshot);
    console.log(`Saved ${screenshot.byteLength} PNG bytes to ${options.output}`);
    return { output: options.output, byteSize: screenshot.byteLength };
  } finally {
    await cleanup(cloud, session, asset);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDemo().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
