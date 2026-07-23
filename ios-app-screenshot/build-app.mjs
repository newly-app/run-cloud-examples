import { execFile } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const exampleDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(exampleDirectory, 'App');
const buildDirectory = join(exampleDirectory, 'build');
const appDirectory = join(buildDirectory, 'RunCloudProof.app');
const archivePath = join(buildDirectory, 'RunCloudProof.app.tar.gz');

export async function buildApp() {
  if (process.platform !== 'darwin') {
    throw new Error('Building the sample app requires macOS with Xcode installed.');
  }

  await rm(appDirectory, { recursive: true, force: true });
  await mkdir(appDirectory, { recursive: true });

  const { stdout } = await execFileAsync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']);
  const sdkPath = stdout.trim();
  const executablePath = join(appDirectory, 'RunCloudProof');

  await execFileAsync(
    'xcrun',
    [
      '--sdk',
      'iphonesimulator',
      'swiftc',
      join(sourceDirectory, 'AppDelegate.swift'),
      '-sdk',
      sdkPath,
      '-target',
      'arm64-apple-ios16.0-simulator',
      '-module-name',
      'RunCloudProof',
      '-parse-as-library',
      '-emit-executable',
      '-o',
      executablePath,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );

  await copyFile(join(sourceDirectory, 'Info.plist'), join(appDirectory, 'Info.plist'));
  await execFileAsync('codesign', ['--force', '--sign', '-', appDirectory]);
  await execFileAsync('tar', ['-czf', archivePath, '-C', buildDirectory, 'RunCloudProof.app']);

  return {
    appDirectory: resolve(appDirectory),
    archivePath: resolve(archivePath),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildApp()
    .then(({ archivePath: output }) => console.log(output))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
