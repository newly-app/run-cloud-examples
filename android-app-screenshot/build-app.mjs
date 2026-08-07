import { execFile } from 'node:child_process';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const exampleDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(exampleDirectory, 'App');
const buildDirectory = join(exampleDirectory, 'build');
const classesDirectory = join(buildDirectory, 'classes');
const dexDirectory = join(buildDirectory, 'dex');
const unsignedApk = join(buildDirectory, 'RunCloudProof-unsigned.apk');
const alignedApk = join(buildDirectory, 'RunCloudProof-aligned.apk');
const archivePath = join(buildDirectory, 'RunCloudProof.apk');
const keyStore = join(buildDirectory, 'debug.keystore');

export async function buildApp(dependencies = {}) {
  const sdkRoot = resolveSdkRoot(dependencies.env ?? process.env);
  const platformDirectory = await latestDirectory(join(sdkRoot, 'platforms'), 'android.jar');
  const toolsDirectory = await latestDirectory(
    join(sdkRoot, 'build-tools'),
    executable('aapt2'),
  );
  const androidJar = join(platformDirectory, 'android.jar');

  await rm(buildDirectory, { recursive: true, force: true });
  await mkdir(classesDirectory, { recursive: true });
  await mkdir(dexDirectory, { recursive: true });

  const run = dependencies.execFile ?? execFileAsync;
  const javaSourceDirectory = join(sourceDirectory, 'cloud', 'run', 'examples', 'screenshot');
  await run('javac', [
    '-encoding',
    'UTF-8',
    '-source',
    '8',
    '-target',
    '8',
    '-classpath',
    androidJar,
    '-d',
    classesDirectory,
    join(javaSourceDirectory, 'MainActivity.java'),
    join(javaSourceDirectory, 'TapTargetAlignment.java'),
  ]);

  const classFiles = await filesBelow(classesDirectory, '.class');
  await run(join(toolsDirectory, executable('d8')), [
    '--lib',
    androidJar,
    '--min-api',
    '23',
    '--output',
    dexDirectory,
    ...classFiles,
  ]);
  await run(join(toolsDirectory, executable('aapt2')), [
    'link',
    '-o',
    unsignedApk,
    '--manifest',
    join(sourceDirectory, 'AndroidManifest.xml'),
    '-I',
    androidJar,
    '--min-sdk-version',
    '23',
    '--target-sdk-version',
    '35',
    '--version-code',
    '1',
    '--version-name',
    '1.0',
  ]);
  await run('jar', ['uf', unsignedApk, '-C', dexDirectory, 'classes.dex']);
  await run(join(toolsDirectory, executable('zipalign')), ['-f', '4', unsignedApk, alignedApk]);
  await run('keytool', [
    '-genkeypair',
    '-keystore',
    keyStore,
    '-storepass',
    'android',
    '-alias',
    'androiddebugkey',
    '-keypass',
    'android',
    '-dname',
    'CN=Android Debug,O=Android,C=US',
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-noprompt',
  ]);
  await run(join(toolsDirectory, executable('apksigner')), [
    'sign',
    '--ks',
    keyStore,
    '--ks-pass',
    'pass:android',
    '--key-pass',
    'pass:android',
    '--out',
    archivePath,
    alignedApk,
  ]);
  await run(join(toolsDirectory, executable('apksigner')), ['verify', '--verbose', archivePath]);

  return { archivePath: resolve(archivePath) };
}

export function resolveSdkRoot(env) {
  const value = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!value) {
    throw new Error('Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed Android SDK.');
  }
  return resolve(value);
}

async function latestDirectory(parent, requiredFile) {
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not inspect Android SDK directory ${parent}.`, { cause: error });
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const candidate of candidates) {
    const directory = join(parent, candidate);
    try {
      await access(join(directory, requiredFile));
      return directory;
    } catch {
      // Continue to an older installed SDK component.
    }
  }
  throw new Error(`Android SDK directory ${parent} has no installation containing ${requiredFile}.`);
}

async function filesBelow(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path, suffix)));
    else if (entry.name.endsWith(suffix)) files.push(path);
  }
  return files;
}

function executable(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildApp()
    .then(({ archivePath: output }) => console.log(output))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
