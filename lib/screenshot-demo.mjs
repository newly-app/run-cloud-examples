import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { inspectPng } from './png.mjs';

const READY_POLL_MS = 1_000;
const OPEN_URL_PROOF_VISUAL_SETTLE_MS = 5_000;
const IOS_DEEP_LINK_PROMPT_SETTLE_MS = 5_000;
const IOS_SAFARI_START_PAGE_DISMISS_SETTLE_MS = 2_000;
const RETRYABLE_SIMULATOR_ACTION_ATTEMPTS = 2;
const RETRYABLE_SIMULATOR_ACTION_DELAY_MS = 1_000;

export const OPEN_URL_PROOF_TARGETS = {
  https: 'https://example.com/search?q=run%20cloud&return=%2Fdocs%3Ftab%3Dmobile',
  deepLink: 'runcloudproof://open/items%2F42?message=hello%20world&return=https%3A%2F%2Fexample.com%2Fdone%3Fx%3D1%26y%3Dtwo#proof',
};

export const IOS_DEEP_LINK_CONFIRMATION = {
  point: { x: 0.69, y: 0.54 },
  requestId: 'example:open-url:ios:confirm',
  timeoutMs: 15_000,
};

export const IOS_SAFARI_START_PAGE_DISMISSAL = {
  point: { x: 0.89, y: 0.11 },
  requestId: 'example:open-url:ios:dismiss-start-page',
  timeoutMs: 15_000,
};

export function parseScreenshotOptions(args, defaultOutput) {
  const options = {
    app: null,
    output: resolve(defaultOutput),
    open: false,
    proveOpenUrls: false,
    json: false,
    readyTimeoutMs: 120_000,
    settleMs: 2_000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--open') {
      options.open = true;
      continue;
    }
    if (argument === '--prove-open-urls') {
      options.proveOpenUrls = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (
      argument === '--app'
      || argument === '--output'
      || argument === '--ready-timeout-ms'
      || argument === '--settle-ms'
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === '--app') options.app = resolve(value);
      if (argument === '--output') options.output = resolve(value);
      if (argument === '--ready-timeout-ms') options.readyTimeoutMs = Number(value);
      if (argument === '--settle-ms') options.settleMs = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  boundedInteger(options.readyTimeoutMs, '--ready-timeout-ms', 1_000, 300_000);
  boundedInteger(options.settleMs, '--settle-ms', 0, 15_000);
  return options;
}

export async function runScreenshotDemo({
  args,
  platform,
  defaultOutput,
  artifactFilename,
  artifactContentType,
  build,
  createClient,
  clientOptions = {},
  open = openBrowser,
  sleep = wait,
  now = Date.now,
  signal,
}) {
  const options = parseScreenshotOptions(args, defaultOutput);
  if (options.help) return { help: true, text: usage(platform) };

  const log = options.json
    ? (...values) => console.error(...values)
    : (...values) => console.log(...values);
  const cloud = createClient(clientOptions);
  const client = cloud[platform];
  if (!client || typeof client.screenshot !== 'function') {
    throw new Error(`Installed @run-cloud/sdk does not support ${platform} screenshots.`);
  }

  let asset;
  let session;
  let metadata;
  let openUrls;
  let operationError;

  try {
    throwIfAborted(signal);
    const archivePath = options.app ?? (await build()).archivePath;
    throwIfAborted(signal);
    const archive = await readFile(archivePath);

    log(`Uploading ${archivePath}...`);
    asset = await cloud.assets.upload(new Blob([archive], { type: artifactContentType }), {
      name: `${platform}-app-screenshot-${now()}`,
      filename: artifactFilename,
    });
    throwIfAborted(signal);

    log(`Creating an ${platform === 'ios' ? 'iOS Simulator' : 'Android Emulator'}...`);
    session = await client.create({
      displayName: `${platform === 'ios' ? 'iOS' : 'Android'} app screenshot`,
      tags: { example: 'app-screenshot', platform },
      installAssets: [asset.id],
      inactivityTimeout: '60s',
      hardTimeout: '10m',
    });

    throwIfAborted(signal);
    session = await waitUntilReady(client, session, options.readyTimeoutMs, {
      sleep,
      now,
      signal,
    });
    if (options.open) {
      if (!session.url) throw new Error('The ready session did not include a viewer URL.');
      await open(session.url);
    }
    throwIfAborted(signal);

    if (options.proveOpenUrls) {
      if (typeof client.openUrl !== 'function') {
        throw new Error(`Installed @run-cloud/sdk does not support ${platform} URL opening.`);
      }
      if (platform === 'ios' && typeof client.tap !== 'function') {
        throw new Error('Installed @run-cloud/sdk does not support iOS browser and prompt confirmation.');
      }
      log(`Opening ${OPEN_URL_PROOF_TARGETS.https}...`);
      const https = verifyOpenUrlResult(
        await client.openUrl(session.id, OPEN_URL_PROOF_TARGETS.https),
        platform,
        session.id,
        OPEN_URL_PROOF_TARGETS.https,
      );
      throwIfAborted(signal);
      await sleep(Math.max(OPEN_URL_PROOF_VISUAL_SETTLE_MS, options.settleMs), signal);
      throwIfAborted(signal);

      if (platform === 'ios') {
        log('Dismissing the fresh Safari Start Page...');
        await runRetryableSimulatorAction(
          () => client.tap(session.id, IOS_SAFARI_START_PAGE_DISMISSAL.point, {
            requestId: IOS_SAFARI_START_PAGE_DISMISSAL.requestId,
            timeoutMs: IOS_SAFARI_START_PAGE_DISMISSAL.timeoutMs,
            signal,
          }),
          {
            sleep,
            signal,
            onRetry: (attempt) => log(
              `Retrying Safari Start Page dismissal after a retryable failure (attempt ${attempt}/${RETRYABLE_SIMULATOR_ACTION_ATTEMPTS})...`,
            ),
          },
        );
        await sleep(IOS_SAFARI_START_PAGE_DISMISS_SETTLE_MS, signal);
        throwIfAborted(signal);
      }

      log(`Opening ${OPEN_URL_PROOF_TARGETS.deepLink}...`);
      const deepLink = verifyOpenUrlResult(
        await client.openUrl(session.id, OPEN_URL_PROOF_TARGETS.deepLink),
        platform,
        session.id,
        OPEN_URL_PROOF_TARGETS.deepLink,
      );
      openUrls = { https, deepLink };
      throwIfAborted(signal);

      if (platform === 'ios') {
        await sleep(Math.max(IOS_DEEP_LINK_PROMPT_SETTLE_MS, options.settleMs), signal);
        throwIfAborted(signal);
        log('Confirming the iOS custom-scheme prompt...');
        await runRetryableSimulatorAction(
          () => client.tap(session.id, IOS_DEEP_LINK_CONFIRMATION.point, {
            requestId: IOS_DEEP_LINK_CONFIRMATION.requestId,
            timeoutMs: IOS_DEEP_LINK_CONFIRMATION.timeoutMs,
            signal,
          }),
          {
            sleep,
            signal,
            onRetry: (attempt) => log(
              `Retrying custom-scheme confirmation after a retryable failure (attempt ${attempt}/${RETRYABLE_SIMULATOR_ACTION_ATTEMPTS})...`,
            ),
          },
        );
        throwIfAborted(signal);
      }
    }

    const finalSettleMs = options.proveOpenUrls
      ? Math.max(OPEN_URL_PROOF_VISUAL_SETTLE_MS, options.settleMs)
      : options.settleMs;
    if (finalSettleMs > 0) await sleep(finalSettleMs, signal);
    throwIfAborted(signal);

    log('Capturing the simulator screen...');
    const screenshot = await client.screenshot(session.id, { signal });
    throwIfAborted(signal);
    const image = inspectPng(screenshot);

    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, screenshot);
    log(`Saved ${screenshot.byteLength} PNG bytes to ${options.output}`);
    metadata = {
      platform,
      sessionId: session.id,
      assetId: asset.id,
      output: options.output,
      byteSize: screenshot.byteLength,
      width: image.width,
      height: image.height,
      ...(openUrls ? { openUrls } : {}),
    };
  } catch (error) {
    operationError = asError(error);
  }

  const cleanup = await cleanupResources(client, cloud.assets, session, asset);
  if (operationError && cleanup.errors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanup.errors.map(({ error }) => error)],
      `Screenshot failed (${operationError.message}); cleanup also failed: ${cleanupSummary(cleanup.errors)}`,
      { cause: operationError },
    );
  }
  if (operationError) throw operationError;
  if (cleanup.errors.length > 0) {
    throw new AggregateError(
      cleanup.errors.map(({ error }) => error),
      `Screenshot was saved, but cleanup failed: ${cleanupSummary(cleanup.errors)}`,
    );
  }

  return {
    ...metadata,
    cleanup: {
      session: cleanup.session,
      asset: cleanup.asset,
    },
  };
}

export async function runRetryableSimulatorAction(
  action,
  { sleep = wait, signal, onRetry } = {},
) {
  for (let attempt = 1; attempt <= RETRYABLE_SIMULATOR_ACTION_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await action();
    } catch (error) {
      const retryable = error
        && typeof error === 'object'
        && !(error instanceof AggregateError)
        && error.retryable === true;
      if (!retryable || attempt === RETRYABLE_SIMULATOR_ACTION_ATTEMPTS) throw error;
      onRetry?.(attempt + 1);
      await sleep(RETRYABLE_SIMULATOR_ACTION_DELAY_MS, signal);
    }
  }
  throw new Error('Retryable simulator action attempts were exhausted.');
}

export async function waitUntilReady(client, initialSession, timeoutMs, dependencies = {}) {
  const sleep = dependencies.sleep ?? wait;
  const now = dependencies.now ?? Date.now;
  const signal = dependencies.signal;
  const deadline = now() + timeoutMs;
  let session = initialSession;

  while (session.status !== 'active') {
    throwIfAborted(signal);
    if (session.status === 'failed' || session.status === 'released') {
      throw new Error(`Session ${session.id} became ${session.status} before screenshot capture.`);
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(`Session ${session.id} was not active within ${timeoutMs} ms.`);
    }
    await sleep(Math.min(READY_POLL_MS, remaining), signal);
    throwIfAborted(signal);
    session = await client.get(session.id);
  }
  return session;
}

export async function cleanupResources(client, assets, session, asset) {
  const result = {
    session: session ? 'pending' : 'not-created',
    asset: asset ? 'pending' : 'not-created',
    errors: [],
  };

  if (session) {
    try {
      await client.delete(session.id);
      result.session = 'released';
    } catch (error) {
      result.session = 'failed';
      result.errors.push({ resource: `session ${session.id}`, error: asError(error) });
    }
  }

  if (asset) {
    try {
      await assets.delete(asset.id);
      result.asset = 'deleted';
    } catch (error) {
      result.asset = 'failed';
      result.errors.push({ resource: `asset ${asset.id}`, error: asError(error) });
    }
  }
  return result;
}

export async function openBrowser(url, dependencies = {}) {
  const hostPlatform = dependencies.platform ?? process.platform;
  const spawnImpl = dependencies.spawn ?? spawn;
  const command = browserCommand(url, hostPlatform, dependencies.comspec);

  await new Promise((resolveOpen, rejectOpen) => {
    const child = spawnImpl(command.file, command.args, { detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      resolveOpen();
    });
    child.once('error', (error) => {
      rejectOpen(new Error(`Could not open the simulator viewer with ${command.file}.`, { cause: error }));
    });
  });
}

export function browserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { file: 'open', args: [url] };
  if (platform === 'win32') {
    return {
      file: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    };
  }
  return { file: 'xdg-open', args: [url] };
}

export function usage(platform) {
  const app = platform === 'ios' ? 'App.app.tar.gz' : 'app.apk';
  return [
    `Usage: npm run demo -- [--open] [--prove-open-urls] [--app path/to/${app}] [--output screenshot.png]`,
    '                         [--ready-timeout-ms 120000] [--settle-ms 2000] [--json]',
  ].join('\n');
}

export function verifyOpenUrlResult(result, platform, sessionId, url) {
  if (
    result?.ok !== true
    || result.platform !== platform
    || result.sessionId !== sessionId
    || typeof result.device !== 'string'
    || result.device.length === 0
    || typeof result.leaseId !== 'string'
    || result.leaseId.length === 0
    || result.url !== url
  ) {
    throw new Error(`The ${platform} URL acknowledgement did not match the active session and exact input URI.`);
  }
  return {
    ok: true,
    platform: result.platform,
    sessionId: result.sessionId,
    device: result.device,
    leaseId: result.leaseId,
    url: result.url,
  };
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function cleanupSummary(errors) {
  return errors.map(({ resource, error }) => `${resource}: ${error.message}`).join('; ');
}

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

function wait(milliseconds, signal) {
  throwIfAborted(signal);
  return new Promise((resolveWait, rejectWait) => {
    const timer = setTimeout(() => finish(resolveWait), milliseconds);
    const cancelled = () => finish(() => rejectWait(asError(signal.reason ?? 'Cancelled.')));
    const finish = (callback) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      callback();
    };
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw asError(signal.reason ?? 'Cancelled.');
}
