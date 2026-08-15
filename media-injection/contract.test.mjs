import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AUDIO_FINGERPRINT,
  AUDIO_FREQUENCY_HZ,
  AUDIO_SAMPLE_RATE,
  CAMERA_FINGERPRINT,
  generateFixtures,
  toneWav,
} from './generate-fixtures.mjs';
import {
  assertMediaPass,
  isExpectedPreInjectionStatus,
  mediaStatus,
  normalizedCenter,
  permissionButton,
} from './proof-contract.mjs';

test('the WAV fixture contains the documented 1 kHz mono samples', () => {
  const wav = toneWav();
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), AUDIO_SAMPLE_RATE);
  assert.equal(wav.readUInt16LE(34), 16);
  const samples = (wav.length - 44) / 2;
  let crossings = 0;
  let previous = wav.readInt16LE(44);
  for (let index = 1; index < samples; index += 1) {
    const current = wav.readInt16LE(44 + index * 2);
    if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) crossings += 1;
    previous = current;
  }
  const measured = crossings * AUDIO_SAMPLE_RATE / (2 * samples);
  assert.ok(Math.abs(measured - AUDIO_FREQUENCY_HZ) < 2, `measured ${measured} Hz`);
});

test('fixture generation retains hashes and machine-readable fingerprints', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'run-cloud-media-fixtures-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const generated = await generateFixtures(directory);
  assert.equal(generated.manifest.camera.fingerprint, CAMERA_FINGERPRINT);
  assert.equal(generated.manifest.microphone.fingerprint, AUDIO_FINGERPRINT);
  assert.equal(
    generated.manifest.camera.sha256,
    '18f1fa44128252d2980a0e5c2cafcedd2b32b73097fa29d0b0efa6f20f3eb4ab',
  );
  assert.equal(
    generated.manifest.microphone.sha256,
    'c6a2b1ac05891fcc3872c9cf553cc12386a045a976215b1e8a07d0a0b1400b41',
  );
  const mp4 = await readFile(generated.cameraPath);
  assert.equal(mp4.subarray(4, 8).toString('ascii'), 'ftyp');
});

test('native proof status and permission controls are found without platform-specific mocks', () => {
  const tree = {
    screen: { width: 100, height: 200 },
    roots: [{
      label: null,
      children: [
        {
          identifier: 'media-proof-status',
          label: 'CAMERA PASS RCAM-v1:RGBY attempt=sdk frames=4 matches=3',
          value: null,
          native: { platform: 'ios' },
          children: [],
        },
        {
          label: 'While using the app',
          bounds: { x: 20, y: 140, width: 60, height: 20 },
          states: { enabled: true },
          native: { platform: 'android', contentDescription: null },
          children: [],
        },
      ],
    }],
  };
  const status = mediaStatus(tree);
  assertMediaPass(status, 'camera', 'sdk');
  const permission = permissionButton(tree);
  assert.equal(permission.label, 'While using the app');
  assert.deepEqual(normalizedCenter(tree, permission), { x: 0.5, y: 0.75 });

  const deepLinkConfirmation = {
    screen: { width: 100, height: 200 },
    roots: [{
      label: null,
      children: [{
        label: 'Open',
        bounds: { x: 50, y: 120, width: 40, height: 30 },
        states: { enabled: true },
        native: { platform: 'ios' },
        children: [],
      }],
    }],
  };
  assert.equal(permissionButton(deepLinkConfirmation).label, 'Open');

  const preAttach = 'CAMERA FAIL code=camera-unavailable attempt=sdk-proof';
  assert.equal(isExpectedPreInjectionStatus(preAttach, {
    platform: 'ios', input: 'camera', attempt: 'sdk-proof',
  }), true);
  assert.equal(isExpectedPreInjectionStatus(preAttach, {
    platform: 'android', input: 'camera', attempt: 'sdk-proof',
  }), false);
});
