import { spawn } from 'node:child_process';

const DEFAULT_TARGETS = [
  'https://run.cloud',
  'https://newly.app',
  'https://reactnative.dev',
];

export function parseOptions(args) {
  const options = { count: 3, duration: 120, open: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--open') {
      options.open = true;
      continue;
    }
    if (argument === '--count' || argument === '--duration') {
      const raw = args[index + 1];
      if (!raw) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2)] = Number(raw);
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (!Number.isInteger(options.count) || options.count < 2 || options.count > 3) {
    throw new Error('--count must be 2 or 3.');
  }
  if (!Number.isInteger(options.duration) || options.duration < 1 || options.duration > 600) {
    throw new Error('--duration must be between 1 and 600 seconds.');
  }
  return options;
}

function runCloud(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.RUNCLOUD_BIN || 'runcloud', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `runcloud exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`runcloud returned invalid JSON: ${stdout.trim()}`));
      }
    });
  });
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

async function releaseSessions(sessions) {
  if (sessions.length === 0) return;
  console.log('\nReleasing simulator sessions...');
  const results = await Promise.allSettled(
    sessions.map((session) => runCloud(['ios', 'delete', session.id, '--json'])),
  );
  results.forEach((result, index) => {
    const session = sessions[index];
    if (result.status === 'fulfilled') console.log(`  released ${session.id}`);
    else console.error(`  failed to release ${session.id}: ${result.reason.message}`);
  });
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run demo -- [--count 2|3] [--duration seconds] [--open]');
    return;
  }

  console.log(`Starting ${options.count} iOS simulator sessions in parallel...`);
  const starts = await Promise.allSettled(
    Array.from({ length: options.count }, async (_, index) => {
      const session = await runCloud([
        'ios',
        'create',
        '--display-name',
        `parallel-demo-${index + 1}`,
        '--label',
        'demo=parallel-simulators',
        '--hard-timeout',
        '10m',
        '--json',
      ]);
      try {
        await runCloud([
          'ios',
          'open-url',
          DEFAULT_TARGETS[index],
          '--id',
          session.id,
          '--json',
        ]);
        return { session, warning: null };
      } catch (error) {
        return {
          session,
          warning: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const sessions = starts
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value.session);
  const failures = starts
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === 'rejected');

  starts.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.warning) {
      console.error(`  simulator ${index + 1} started, but its page did not open: ${result.value.warning}`);
    }
  });
  failures.forEach(({ result, index }) => {
    console.error(`  simulator ${index + 1} failed: ${result.reason.message}`);
  });
  if (sessions.length === 0) throw new Error('No simulator sessions could be started.');

  console.log('\nLive sessions:');
  sessions.forEach((session, index) => {
    console.log(`  ${index + 1}. ${session.url || session.baseUrl || session.id}`);
    if (options.open && session.url) openBrowser(session.url);
  });

  try {
    console.log(`\nKeeping the demo live for ${options.duration} seconds. Press Ctrl+C to finish early.`);
    await waitForDemo(options.duration);
  } finally {
    await releaseSessions(sessions);
  }

  if (failures.length > 0) process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
