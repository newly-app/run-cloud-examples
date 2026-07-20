import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from '@run-cloud/sdk';

const DEFAULT_URLS = {
  ios: 'https://newly.app',
  android: 'https://run.cloud',
};

const CODECS = ['auto', 'mjpeg', 'webrtc'];

export function parseOptions(args) {
  const options = {
    platform: 'both',
    duration: 120,
    codec: 'auto',
    open: false,
    json: false,
    keep: false,
    iosUrl: DEFAULT_URLS.ios,
    androidUrl: DEFAULT_URLS.android,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--open') {
      options.open = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--keep') {
      options.keep = true;
      continue;
    }
    if (argument === '--platform' || argument === '--duration' || argument === '--codec' || argument === '--ios-url' || argument === '--android-url') {
      const raw = args[index + 1];
      if (!raw) throw new Error(`${argument} requires a value.`);
      if (argument === '--platform') options.platform = raw;
      if (argument === '--duration') options.duration = Number(raw);
      if (argument === '--codec') options.codec = raw;
      if (argument === '--ios-url') options.iosUrl = raw;
      if (argument === '--android-url') options.androidUrl = raw;
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (!['ios', 'android', 'both'].includes(options.platform)) {
    throw new Error('--platform must be ios, android, or both.');
  }
  if (!CODECS.includes(options.codec)) {
    throw new Error('--codec must be auto, mjpeg, or webrtc.');
  }
  if (!Number.isInteger(options.duration) || options.duration < 1 || options.duration > 600) {
    throw new Error('--duration must be between 1 and 600 seconds.');
  }
  for (const [name, value] of [['--ios-url', options.iosUrl], ['--android-url', options.androidUrl]]) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`${name} must use HTTP or HTTPS.`);
    }
  }

  return options;
}

export function browserCommand(url, platform = process.platform) {
  return platform === 'darwin'
    ? ['open', [url]]
    : platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
}

function openBrowser(url) {
  const command = browserCommand(url);
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

function waitForDemo(seconds) {
  return new Promise((resolve) => {
    const finish = (reason) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      resolve(reason);
    };
    const timer = setTimeout(() => finish('timer'), seconds * 1000);
    const interrupt = () => finish('interrupt');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
  });
}

function requestedPlatforms(value) {
  return value === 'both' ? ['ios', 'android'] : [value];
}

function summarizeSession(session) {
  return {
    id: session.id,
    platform: session.platform,
    status: session.status,
    url: session.url,
    baseUrl: session.baseUrl,
    codec: session.codec,
    stream: session.stream,
    expiresAt: session.expiresAt,
  };
}

async function releaseSessions(cloud, sessions, { json = false } = {}) {
  if (sessions.length === 0) return;
  if (!json) console.log('\nReleasing sessions...');
  const results = await Promise.allSettled(
    sessions.map((session) => cloud.simulators.delete(session.id, { platform: session.platform })),
  );
  results.forEach((result, index) => {
    const session = sessions[index];
    if (json) return;
    if (result.status === 'fulfilled') console.log(`  released ${session.platform} ${session.id}`);
    else console.error(`  failed to release ${session.platform} ${session.id}: ${result.reason.message}`);
  });
}

export async function runDemo(args = process.argv.slice(2), clientOptions = {}) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('Usage: npm run demo -- [--platform ios|android|both] [--codec auto|mjpeg|webrtc] [--duration seconds] [--open] [--json] [--keep] [--ios-url URL] [--android-url URL]');
    return;
  }

  const cloud = new Client(clientOptions);
  const sessions = [];

  try {
    const account = await cloud.account();
    if (!options.json) {
      console.log(`Account: ${account.meteringStatus ?? 'unknown metering'}; balance ${account.balanceMinutes ?? 'unknown'} minutes`);
    }

    for (const platform of requestedPlatforms(options.platform)) {
      const session = await cloud.simulators.create({
        platform,
        displayName: `sdk-${platform}-demo`,
        labels: { demo: 'sdk-ios-android' },
        inactivityTimeout: '60s',
        hardTimeout: '10m',
        codec: options.codec,
      });
      sessions.push(session);

      const targetUrl = platform === 'ios' ? options.iosUrl : options.androidUrl;
      await cloud.simulators.openUrl(session.id, targetUrl, { platform });
      if (!options.json) console.log(`${platform}: ${session.url || session.baseUrl || session.id} (${session.codec})`);
      if (options.open && session.url) openBrowser(session.url);
    }

    if (options.json) {
      console.log(JSON.stringify({ account, sessions: sessions.map(summarizeSession) }, null, 2));
    }

    if (options.keep) {
      if (!options.json) console.log('\nLeaving sessions running. Release them from the dashboard or API when done.');
      return;
    }

    if (!options.json) {
      console.log(`\nKeeping ${sessions.length} session(s) live for ${options.duration} seconds. Press Ctrl+C to finish early.`);
    }
    await waitForDemo(options.duration);
  } finally {
    if (!options.keep) await releaseSessions(cloud, sessions, { json: options.json });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDemo().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
