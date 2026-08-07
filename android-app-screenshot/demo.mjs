import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@run-cloud/sdk';
import { runScreenshotDemo } from '../lib/screenshot-demo.mjs';
import { buildApp } from './build-app.mjs';

export async function runDemo(args = process.argv.slice(2), dependencies = {}) {
  const result = await runScreenshotDemo({
    args,
    platform: 'android',
    defaultOutput: resolve('screenshots', 'run-cloud-proof.png'),
    artifactFilename: 'RunCloudProof.apk',
    artifactContentType: 'application/vnd.android.package-archive',
    build: dependencies.build ?? buildApp,
    createClient: dependencies.createClient ?? ((options) => new Client(options)),
    clientOptions: dependencies.clientOptions,
    open: dependencies.open,
    sleep: dependencies.sleep,
    now: dependencies.now,
    signal: dependencies.signal,
  });

  if (result.help) console.log(result.text);
  else if (args.includes('--json')) console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromCommandLine();
}

function runFromCommandLine() {
  const controller = new AbortController();
  const cancel = (name, exitCode) => {
    process.exitCode = exitCode;
    controller.abort(new Error(`Cancelled by ${name}.`));
  };
  const interrupt = () => cancel('SIGINT', 130);
  const terminate = () => cancel('SIGTERM', 143);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  runDemo(process.argv.slice(2), { signal: controller.signal })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      if (!process.exitCode) process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    });
}
