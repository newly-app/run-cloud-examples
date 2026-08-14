import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ffmpegStatic from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
export const CAMERA_FINGERPRINT = 'RCAM-v1:RGBY';
export const AUDIO_FINGERPRINT = 'RAUD-v1:1000Hz';
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_FREQUENCY_HZ = 1_000;
export const FIXTURE_DURATION_SECONDS = 6;

export async function generateFixtures(outputDirectory, dependencies = {}) {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const cameraPath = resolve(directory, 'camera-rgb-quadrants.mp4');
  const microphonePath = resolve(directory, 'microphone-1000hz.wav');
  await writeFile(microphonePath, toneWav());

  const run = dependencies.execFile ?? execFileAsync;
  const ffmpeg = dependencies.ffmpeg ?? ffmpegStatic;
  if (!ffmpeg) throw new Error('the pinned ffmpeg-static binary is unavailable for this platform');
  await run(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f', 'lavfi', '-i', `color=c=red:s=320x240:r=10:d=${FIXTURE_DURATION_SECONDS}`,
      '-f', 'lavfi', '-i', `color=c=lime:s=320x240:r=10:d=${FIXTURE_DURATION_SECONDS}`,
      '-f', 'lavfi', '-i', `color=c=blue:s=320x240:r=10:d=${FIXTURE_DURATION_SECONDS}`,
      '-f', 'lavfi', '-i', `color=c=yellow:s=320x240:r=10:d=${FIXTURE_DURATION_SECONDS}`,
      '-filter_complex',
      '[0:v][1:v]hstack=inputs=2[top];[2:v][3:v]hstack=inputs=2[bottom];'
        + '[top][bottom]vstack=inputs=2,format=yuv420p[pattern]',
      '-map', '[pattern]',
      '-map_metadata', '-1',
      '-an',
      '-c:v', 'libx264',
      '-threads', '1',
      '-fflags', '+bitexact',
      '-flags:v', '+bitexact',
      '-preset', 'veryfast',
      '-crf', '12',
      '-movflags', '+faststart',
      '-metadata', `comment=${CAMERA_FINGERPRINT}`,
      cameraPath,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );

  const [camera, microphone] = await Promise.all([
    fixtureRecord(cameraPath, 'video/mp4', CAMERA_FINGERPRINT),
    fixtureRecord(microphonePath, 'audio/wav', AUDIO_FINGERPRINT),
  ]);
  const manifest = {
    schemaVersion: 1,
    durationSeconds: FIXTURE_DURATION_SECONDS,
    camera: {
      ...camera,
      width: 640,
      height: 480,
      framesPerSecond: 10,
      expectedQuadrants: ['red', 'green', 'blue', 'yellow'],
    },
    microphone: {
      ...microphone,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      frequencyHz: AUDIO_FREQUENCY_HZ,
    },
  };
  await writeFile(
    resolve(directory, 'fixture-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return { directory, cameraPath, microphonePath, manifest };
}

export function toneWav() {
  const sampleCount = AUDIO_SAMPLE_RATE * FIXTURE_DURATION_SECONDS;
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  wav.writeUInt32LE(AUDIO_SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelopeSamples = Math.min(index, sampleCount - index - 1, AUDIO_SAMPLE_RATE / 50);
    const envelope = Math.min(1, envelopeSamples / (AUDIO_SAMPLE_RATE / 50));
    const sample = Math.round(
      Math.sin(2 * Math.PI * AUDIO_FREQUENCY_HZ * index / AUDIO_SAMPLE_RATE)
        * 0.65
        * envelope
        * 32767,
    );
    wav.writeInt16LE(sample, 44 + index * 2);
  }
  return wav;
}

async function fixtureRecord(path, contentType, fingerprint) {
  const bytes = await readFile(path);
  return {
    filename: path.split('/').at(-1),
    contentType,
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fingerprint,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), 'build/fixtures');
  generateFixtures(output)
    .then(({ manifest }) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
