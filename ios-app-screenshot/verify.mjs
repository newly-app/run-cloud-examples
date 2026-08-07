import { runDemo } from './demo.mjs';
import { verifyScreenshotExample } from '../test-support/verify-screenshot-example.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';

verifyScreenshotExample({
  platform: 'ios',
  runDemo,
  artifactContentType: 'application/gzip',
  artifactFilename: 'RunCloudProof.app.tar.gz',
});

it('builds an Apple Silicon simulator app with the normal Xcode toolchain', async () => {
  const build = await readFile(new URL('./build-app.mjs', import.meta.url), 'utf8');
  const source = await readFile(new URL('./App/AppDelegate.swift', import.meta.url), 'utf8');
  const plist = await readFile(new URL('./App/Info.plist', import.meta.url), 'utf8');
  const readme = await readFile(new URL('./README.md', import.meta.url), 'utf8');
  assert.match(build, /xcrun.*iphonesimulator/s);
  assert.match(build, /arm64-apple-ios16\.0-simulator/);
  assert.match(build, /codesign/);
  assert.match(build, /RunCloudProof\.app\.tar\.gz/);
  assert.match(source, /@main/);
  assert.match(source, /accessibilityIdentifier = "tap-target"/);
  assert.match(source, /accessibilityIdentifier = "text-input"/);
  assert.match(source, /accessibilityIdentifier = "gesture-area"/);
  assert.match(source, /accessibilityIdentifier = "swipe-scroll"/);
  assert.match(source, /id: "tap-state"/);
  assert.match(source, /id: "swipe-state"/);
  assert.match(source, /id: "gesture-state"/);
  assert.match(source, /id: "key-state"/);
  assert.match(source, /override var keyCommands/);
  assert.match(source, /let page = UIScrollView\(\)/);
  assert.match(source, /page\.contentLayoutGuide/);
  assert.match(plist, /UIInterfaceOrientationLandscapeLeft/);
  assert.match(plist, /UIInterfaceOrientationLandscapeRight/);
  assert.match(readme, /npm run demo -- --json/);
  assert.match(readme, /--ready-timeout-ms NUMBER/);
  assert.match(readme, /cleanup.*session.*released.*asset.*deleted/s);
  assert.match(readme, /tap `0\.50,0\.23`/);
  assert.match(readme, /After a\s+rotation/);
});
