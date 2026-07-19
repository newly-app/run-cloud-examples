import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('sdk-ios-android example', () => {
  it('documents and uses the public SDK for both simulator platforms', () => {
    const demo = readFileSync(new URL('./demo.mjs', import.meta.url), 'utf8');
    const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');

    assert.match(demo, /from '@run-cloud\/sdk'/);
    assert.match(demo, /platform: 'both'/);
    assert.match(demo, /cloud\.simulators\.create/);
    assert.match(demo, /cloud\.simulators\.openUrl/);
    assert.match(demo, /cloud\.simulators\.delete/);
    assert.match(readme, /--platform ios/);
    assert.match(readme, /--platform android/);
  });
});
