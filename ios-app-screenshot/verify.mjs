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
  assert.match(source, /accessibilityIdentifier = "accessibility-heading"/);
  assert.match(source, /id: "nested-label"/);
  assert.match(source, /id: "name-field"/);
  assert.match(source, /id: "password-field"/);
  assert.match(source, /value: "runcloud-secret-42"/);
  assert.match(source, /password\.isSecureTextEntry = true/);
  assert.match(source, /accessibilityIdentifier = "notifications-toggle"/);
  assert.match(source, /accessibilityIdentifier = "disabled-submit"/);
  assert.match(source, /disabled\.isEnabled = false/);
  assert.match(source, /accessibilityIdentifier = "navigate-button"/);
  assert.match(source, /accessibilityContainerType = \.semanticGroup/);
  assert.match(source, /override var keyCommands/);
  assert.match(source, /let page = UIScrollView\(\)/);
  assert.match(source, /page\.contentLayoutGuide/);
  assert.match(plist, /UIInterfaceOrientationLandscapeLeft/);
  assert.match(plist, /UIInterfaceOrientationLandscapeRight/);
  assert.match(readme, /npm run demo -- --prove-open-urls --open --json/);
  assert.match(readme, /--app "\$RUNNER_TEMP\/native-app\/RunCloudProof\.app\.tar\.gz"[\s\S]*--prove-open-urls[\s\S]*--json/);
  assert.match(readme, /--ready-timeout-ms NUMBER/);
  assert.match(readme, /cleanup.*session.*released.*asset.*deleted/s);
  assert.match(readme, /tap `0\.50,0\.23`/);
  assert.match(readme, /After a\s+rotation/);
});

it('registers runcloudproof and visibly preserves cold and warm encoded deep links', async () => {
  const source = await readFile(new URL('./App/AppDelegate.swift', import.meta.url), 'utf8');
  const plist = await readFile(new URL('./App/Info.plist', import.meta.url), 'utf8');
  const readme = await readFile(new URL('./README.md', import.meta.url), 'utf8');

  assert.match(plist, /CFBundleURLSchemes[\s\S]*<string>runcloudproof<\/string>/);
  assert.match(source, /launchOptions\?\[\.url\][\s\S]*delivery: "cold"/);
  assert.match(source, /open url: URL[\s\S]*delivery: "warm"/);
  assert.match(source, /id: "deep-link-state"/);
  assert.match(source, /url\.absoluteString/);
  assert.match(source, /lineBreakMode = \.byCharWrapping/);
  assert.match(
    readme,
    /runcloudproof:\/\/open\/items%2F42\?message=hello%20world&return=https%3A%2F%2Fexample\.com%2Fdone%3Fx%3D1%26y%3Dtwo#proof/,
  );
  assert.match(readme, /same URI byte for byte/);
  assert.match(readme, /both six-field acknowledgements/);
  assert.match(readme, /never prints the signed viewer URL/);
  assert.match(readme, /Open in Run Cloud Proof/);
  assert.match(readme, /authenticated SDK tap/);
  assert.match(readme, /at least five seconds[\s\S]*at least five more seconds/);
});
