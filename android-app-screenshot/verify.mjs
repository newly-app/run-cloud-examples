import { runDemo } from './demo.mjs';
import { verifyScreenshotExample } from '../test-support/verify-screenshot-example.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { promisify } from 'node:util';
import { resolveSdkRoot } from './build-app.mjs';

const execFileAsync = promisify(execFile);

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
  const alignment = await readFile(
    new URL('./App/cloud/run/examples/screenshot/TapTargetAlignment.java', import.meta.url),
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
  assert.match(source, /target\.getLocationOnScreen/);
  assert.match(source, /target\.setTranslationY\(alignment\.translationY\)/);
  assert.match(alignment, /Math\.max\(0, delta\)/);
  assert.match(alignment, /Math\.min\(0, delta\)/);
  assert.match(source, /KeyEvent\.isModifierKey/);
  assert.match(source, /showKey\("Enter"\)/);
  assert.match(source, /event\.isAltPressed\(\), "Option"/);
  assert.match(source, /event\.isMetaPressed\(\), "Command"/);
  assert.match(source, /setClickable\(true\)/);
  assert.match(source, /performClick\(\)/);
  assert.match(readme, /npm run demo -- --json/);
  assert.match(readme, /--ready-timeout-ms NUMBER/);
  assert.match(readme, /cleanup.*session.*released.*asset.*deleted/s);
  assert.match(readme, /tap `0\.50,0\.23`/);
  assert.match(readme, /stays\s+anchored at `0\.50,0\.23` in both portrait and landscape/);
  assert.match(readme, /After a\s+rotation/);
});

it('keeps the normalized tap target centered in portrait and landscape', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'run-cloud-tap-alignment-'));
  const source = new URL(
    './App/cloud/run/examples/screenshot/TapTargetAlignment.java',
    import.meta.url,
  );
  const testSource = join(directory, 'TapTargetAlignmentContract.java');
  await writeFile(
    testSource,
    `package cloud.run.examples.screenshot;

public final class TapTargetAlignmentContract {
    public static void main(String[] args) {
        assertAlignment(2400, 300, 552, 252, 0);
        assertAlignment(1080, 420, 248, 0, -172);
        assertAlignment(1000, 230, 230, 0, 0);
    }

    private static void assertAlignment(
        int viewportHeight,
        int originalCenter,
        int expectedCenter,
        int expectedSpacer,
        int expectedTranslation
    ) {
        TapTargetAlignment.Result result = TapTargetAlignment.calculate(
            viewportHeight,
            originalCenter,
            0.23f
        );
        int actualCenter = originalCenter + result.spacerHeight + result.translationY;
        if (actualCenter != expectedCenter
            || result.spacerHeight != expectedSpacer
            || result.translationY != expectedTranslation) {
            throw new AssertionError(
                "Expected center/spacer/translation "
                    + expectedCenter + "/" + expectedSpacer + "/" + expectedTranslation
                    + " but got " + actualCenter + "/" + result.spacerHeight + "/"
                    + result.translationY
            );
        }
    }
}
`,
  );

  try {
    await execFileAsync('javac', ['-d', directory, source.pathname, testSource]);
    await execFileAsync('java', [
      '-cp',
      directory,
      'cloud.run.examples.screenshot.TapTargetAlignmentContract',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('requires an explicit Android SDK root', () => {
  assert.equal(resolveSdkRoot({ ANDROID_HOME: '/tmp/android-sdk' }), '/tmp/android-sdk');
  assert.throws(() => resolveSdkRoot({}), /ANDROID_HOME or ANDROID_SDK_ROOT/);
});
