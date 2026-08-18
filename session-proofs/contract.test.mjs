import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('capability proof uses independent public SDK and CLI sessions and validates real media files', async () => {
  const source = await readFile(new URL('./capabilities.live.test.mjs', import.meta.url), 'utf8');
  assert.match(source, /for \(const surface of \['sdk', 'cli'\]\)/);
  assert.match(source, /startRecording\(/);
  assert.match(source, /recording',\s+'start'/);
  assert.match(source, /stopRecording\(/);
  assert.match(source, /recording',\s+'download'/);
  assert.match(source, /assertMp4\(bytes, ready/);
  assert.match(source, /assertPng\(screenshot/);
  assert.match(source, /production-open-url/);
  assert.doesNotMatch(source, /fake|mock/i);
});

test('expiry proof crosses the stated deadline and observes both SDK and CLI terminal state', async () => {
  const source = await readFile(new URL('./expiry.live.test.mjs', import.meta.url), 'utf8');
  assert.match(source, /const HARD_TIMEOUT = '90s'/);
  assert.match(source, /service-auto-releases-at-hard-expiry/);
  assert.match(source, /cli-observes-auto-release/);
  assert.match(source, /expired-public-operations-rejected/);
  assert.match(source, /sdkFailure\.status, 404/);
  assert.match(source, /public-meter-stops-at-expiry/);
  assert.match(source, /assert\.equal\(second, first/);
  assert.match(source, /session-cookie-mints-bounded-exec-jwt/);
  assert.match(source, /expired-session-cookie-cannot-mint-exec-jwt/);
  assert.match(source, /exec-ws-open-socket-dies-at-expiry/);
  assert.match(source, /exec-ws-expired-handshake-rejected/);
  assert.doesNotMatch(source, /fake|mock/i);
});

test('retained evidence never serializes signed session or exec credentials', async () => {
  const [support, capabilities, expiry] = await Promise.all([
    readFile(new URL('./support.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./capabilities.live.test.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./expiry.live.test.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(support, /sessionEvidence\(session\)/);
  assert.doesNotMatch(support.match(/function sessionEvidence[\s\S]*?\n\}/)?.[0] ?? '', /url|token/i);
  assert.doesNotMatch(capabilities, /writeJson\([^\n]+(?:token|credential)/i);
  assert.doesNotMatch(expiry, /writeJson\([^\n]+(?:token|credential)/i);
});
