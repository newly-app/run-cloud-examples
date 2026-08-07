import { runDemo } from './demo.mjs';
import { verifyScreenshotExample } from '../test-support/verify-screenshot-example.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { resolveSdkRoot } from './build-app.mjs';

verifyScreenshotExample({
  platform: 'android',
  runDemo,
  artifactContentType: 'application/vnd.android.package-archive',
  artifactFilename: 'RunCloudProof.apk',
});

it('builds a launchable native APK with standard Android SDK tools', async () => {
  const build = await readFile(new URL('./build-app.mjs', import.meta.url), 'utf8');
  const manifest = await readFile(new URL('./App/AndroidManifest.xml', import.meta.url), 'utf8');
  const source = await readFile(
    new URL('./App/cloud/run/examples/screenshot/MainActivity.java', import.meta.url),
    'utf8',
  );
  const readme = await readFile(new URL('./README.md', import.meta.url), 'utf8');
  assert.match(build, /'d8'/);
  assert.match(build, /'aapt2'/);
  assert.match(build, /'zipalign'/);
  assert.match(build, /'apksigner'/);
  assert.match(manifest, /android\.intent\.category\.LAUNCHER/);
  assert.match(source, /extends Activity/);
  assert.match(source, /setContentDescription\("tap-target"\)/);
  assert.match(source, /setContentDescription\("text-input"\)/);
  assert.match(source, /setContentDescription\("gesture-area"\)/);
  assert.match(source, /setContentDescription\("swipe-scroll"\)/);
  assert.match(source, /dispatchKeyEvent/);
  assert.match(source, /TAP_TARGET_NORMALIZED_Y = 0\.23f/);
  assert.match(source, /page\.addView\(content/);
  assert.match(source, /KeyEvent\.isModifierKey/);
  assert.match(source, /performClick\(\)/);
  assert.match(readme, /npm run demo -- --json/);
  assert.match(readme, /--ready-timeout-ms NUMBER/);
  assert.match(readme, /cleanup.*session.*released.*asset.*deleted/s);
  assert.match(readme, /tap `0\.50,0\.23`/);
});

it('requires an explicit Android SDK root', () => {
  assert.equal(resolveSdkRoot({ ANDROID_HOME: '/tmp/android-sdk' }), '/tmp/android-sdk');
  assert.throws(() => resolveSdkRoot({}), /ANDROID_HOME or ANDROID_SDK_ROOT/);
});
