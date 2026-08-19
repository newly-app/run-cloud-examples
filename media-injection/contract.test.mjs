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
  boundedRequestId,
  deepLinkConfirmationPoint,
  isExpectedPreInjectionStatus,
  isRetryableAccessibilityFailure,
  mediaStatus,
  normalizedCenter,
  permissionButton,
} from './proof-contract.mjs';

test('interaction request IDs stay valid and unique at the public SDK boundary', () => {
  const first = boundedRequestId(
    'media',
    'a'.repeat(64),
    'ios',
    'microphone',
    'cli-r3-b'.repeat(8),
    'post-injection-permission',
    0,
  );
  const second = boundedRequestId(
    'media',
    'a'.repeat(64),
    'ios',
    'microphone',
    'cli-r3-b'.repeat(8),
    'post-injection-permission',
    1,
  );
  assert.equal(first.length, 128);
  assert.match(first, /^[A-Za-z0-9._:-]{1,128}$/);
  assert.notEqual(first, second);
  assert.equal(boundedRequestId('media', 'short', 'tap'), 'media:short:tap');
});

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

test('the iOS fixture waits for injection and fingerprints actual microphone callbacks', async () => {
  const source = await readFile(
    new URL('../ios-app-screenshot/App/MediaProof.swift', import.meta.url),
    'utf8',
  );
  assert.match(source, /nativeFormat\.sampleRate > 0 && nativeFormat\.channelCount > 0/);
  assert.match(source, /environment\["SIMAUDIO_FILE"\]/);
  assert.match(source, /standardFormatWithSampleRate: 48_000, channels: 1/);
  assert.match(source, /format: hasInjectedAudio \? tapFormat : nil/);
  assert.match(
    source,
    /if !hasInjectedAudio \{\s+try session\.setCategory\(\.record, mode: \.measurement\)\s+try session\.setActive\(true\)/,
  );
  assert.match(source, /if !hasInjectedAudio \{\s+engine\.prepare\(\)\s+try engine\.start\(\)/);
  assert.match(source, /let callbackRate = buffer\.format\.sampleRate/);
  assert.match(source, /buffer\.format\.channelCount > 0/);
  assert.match(source, /fail\("MICROPHONE", code: "microphone-format"\)/);
  assert.match(source, /asyncAfter\(deadline: \.now\(\) \+ \.milliseconds\(250\)\)/);
  assert.match(source, /self\?\.configureMicrophone\(\)/);
});

test('the iOS fixture keeps live media progress out of the accessibility tree', async () => {
  const source = await readFile(
    new URL('../ios-app-screenshot/App/MediaProof.swift', import.meta.url),
    'utf8',
  );
  assert.match(source, /if !cameraPassed, matchingCameraFrames >= 3/);
  assert.match(source, /else if !cameraPassed, observedCameraFrames % 10 == 0 \{\s+logProgress\(/);
  assert.match(source, /if !self\.microphonePassed, observation\.matchedWindows >= 3/);
  assert.match(source, /else if !self\.microphonePassed, observation\.windows % 4 == 0 \{\s+self\.logProgress\(/);
});

test('the Android fixture recognizes the full pattern without keeping accessibility busy', async () => {
  const source = await readFile(
    new URL(
      '../android-app-screenshot/App/cloud/run/examples/screenshot/MediaProofController.java',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /int\[\] fractions = new int\[\] \{ 5, 20, 35, 50, 65, 80, 95 \}/);
  assert.match(source, /colors\.contains\("R"\)/);
  assert.match(source, /colors\.contains\("G"\)/);
  assert.match(source, /colors\.contains\("B"\)/);
  assert.match(source, /colors\.contains\("Y"\)/);
  assert.match(source, /matchingCameraFrames >= 3/);
  assert.match(
    source,
    /else if \(!cameraPassed && observedCameraFrames % 10 == 0\) \{\s+Log\.d\(/,
  );
});

test('the live proof replaces only persistently inaccessible simulator sessions', async () => {
  const source = await readFile(new URL('./live.test.mjs', import.meta.url), 'utf8');
  assert.match(source, /const ACCESSIBILITY_RECOVERY_TIMEOUT_MS = 60_000/);
  assert.match(source, /const MAX_SURFACE_SESSION_ATTEMPTS = 3/);
  assert.match(source, /error\?\.code === 'media_session_accessibility_unavailable'/);
  assert.match(source, /error\?\.action === 'accessibility'/);
  assert.match(source, /retryable-accessibility-failure/);
  assert.match(source, /sessionRetries/);
  assert.match(source, /const TRANSIENT_EDGE_RETRY_DELAYS_MS = \[250, 750, 1_500\]/);
  assert.match(source, /isTransientEdgeFailure/);
  assert.match(source, /withTransientEdgeRetry\(\s+\(\) => writeScreenshot/);
  assert.match(source, /withTransientEdgeRetry\(\s+\(\) => simulator\.logs/);
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
  assertMediaPass('CAMERA PASS RCAM-v1:RGBY attempt=sdk frames=184 matches=184', 'camera', 'sdk');
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
  assert.deepEqual(deepLinkConfirmationPoint('ios', null, false), { x: 0.69, y: 0.535 });
  assert.equal(deepLinkConfirmationPoint('android', null, false), null);
  assert.equal(deepLinkConfirmationPoint('ios', 'CAMERA READY', false), null);
  assert.equal(deepLinkConfirmationPoint('ios', null, true), null);

  const preAttach = 'CAMERA FAIL code=camera-unavailable attempt=sdk-proof';
  assert.equal(isExpectedPreInjectionStatus(preAttach, {
    platform: 'ios', input: 'camera', attempt: 'sdk-proof',
  }), true);
  assert.equal(isExpectedPreInjectionStatus(preAttach, {
    platform: 'android', input: 'camera', attempt: 'sdk-proof',
  }), false);

  const preAudioAttach = 'MICROPHONE FAIL code=microphone-format attempt=cli-proof';
  assert.equal(isExpectedPreInjectionStatus(preAudioAttach, {
    platform: 'ios', input: 'microphone', attempt: 'cli-proof',
  }), true);
  assert.equal(isExpectedPreInjectionStatus(preAudioAttach, {
    platform: 'ios', input: 'microphone', attempt: 'another-proof',
  }), false);

  assert.equal(isRetryableAccessibilityFailure({
    retryable: true,
    code: 'accessibility_unavailable',
    action: 'accessibility',
  }), true);
  assert.equal(isRetryableAccessibilityFailure({
    retryable: true,
    code: 'accessibility_transport_error',
    action: 'accessibility',
  }), true);
  assert.equal(isRetryableAccessibilityFailure({
    retryable: true,
    code: 'accessibility_timeout',
    action: 'accessibility',
  }), true);
  assert.equal(isRetryableAccessibilityFailure({
    retryable: false,
    code: 'accessibility_unavailable',
    action: 'accessibility',
  }), false);
  assert.equal(isRetryableAccessibilityFailure({
    retryable: true,
    code: 'simulator_session_ended',
    action: 'accessibility',
  }), false);
});
