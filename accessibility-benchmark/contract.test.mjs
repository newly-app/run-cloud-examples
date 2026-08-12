import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@run-cloud/sdk';
import { assertBenchmarkTree, benchmarkContract } from './contract.mjs';

const repositoryRoot = new URL('../', import.meta.url);

test('the native benchmark contract is versioned and built from maintained MIT source', async () => {
  assert.equal(benchmarkContract.schemaVersion, 1);
  assert.equal(benchmarkContract.source.license, 'MIT');
  assert.deepEqual(Object.keys(benchmarkContract.source).sort(), ['android', 'ios', 'license']);
  const license = await readFile(new URL('LICENSE', repositoryRoot), 'utf8');
  assert.match(license, /MIT License/);

  const iosBuild = await readFile(new URL('ios-app-screenshot/build-app.mjs', repositoryRoot), 'utf8');
  const androidBuild = await readFile(
    new URL('android-app-screenshot/build-app.mjs', repositoryRoot),
    'utf8',
  );
  assert.match(iosBuild, /swiftc/);
  assert.match(iosBuild, /arm64-apple-ios16\.0-simulator/);
  assert.doesNotMatch(iosBuild, /https?:\/\/|curl|wget/);
  assert.match(androidBuild, /'javac'/);
  assert.match(androidBuild, /'d8'/);
  assert.match(androidBuild, /'aapt2'/);
  assert.doesNotMatch(androidBuild, /https?:\/\/|curl|wget/);
});

test('the Swift and Java fixtures contain every documented label and state transition', async () => {
  const [swift, java, documentation] = await Promise.all([
    readFile(new URL('ios-app-screenshot/App/AppDelegate.swift', repositoryRoot), 'utf8'),
    readFile(
      new URL(
        'android-app-screenshot/App/cloud/run/examples/screenshot/MainActivity.java',
        repositoryRoot,
      ),
      'utf8',
    ),
    readFile(new URL('accessibility-benchmark/README.md', repositoryRoot), 'utf8'),
  ]);
  for (const state of Object.values(benchmarkContract.states)) {
    for (const value of [state.nestedLabel, state.navigationLabel]) {
      assert.ok(swift.includes(value), `Swift source omitted ${value}`);
      assert.ok(java.includes(value), `Java source omitted ${value}`);
    }
    for (const value of [state.nestedLabel, state.status, state.navigationLabel]) {
      assert.ok(documentation.includes(value), `benchmark documentation omitted ${value}`);
    }
  }
  for (const node of Object.values(benchmarkContract.nodes)) {
    for (const label of node.labels) {
      assert.ok(documentation.includes(label), `benchmark documentation omitted ${label}`);
    }
  }
  assert.match(swift, /password\.isSecureTextEntry = true/);
  assert.match(java, /TYPE_TEXT_VARIATION_PASSWORD/);
  assert.match(swift, /Notifications:.*isOn.*on.*off/s);
  assert.match(java, /Notifications:.*isChecked\(\).*on.*off/s);
  assert.match(swift, /disabled\.isEnabled = false/);
  assert.match(java, /disabled\.setEnabled\(false\)/);
});

test('the live suite uses only the published SDK surface and owns cleanup artifacts', async () => {
  const [manifest, source] = await Promise.all([
    readFile(new URL('accessibility-benchmark/package.json', repositoryRoot), 'utf8'),
    readFile(new URL('accessibility-benchmark/live.test.mjs', repositoryRoot), 'utf8'),
  ]);
  const packageJson = JSON.parse(manifest);
  assert.equal(packageJson.dependencies['@run-cloud/sdk'], '0.22.0');
  assert.match(source, /import \{ Client \} from '@run-cloud\/sdk'/);
  assert.match(source, /simulator\.create/);
  assert.match(source, /simulator\.accessibilityTree/);
  assert.match(source, /simulator\.tap/);
  assert.match(source, /simulator\.delete/);
  assert.match(source, /cloud\.assets\.delete/);
  assert.match(source, /-cleanup\.json/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test('the pinned public SDK exposes every benchmark method without a network request', () => {
  const rejectNetwork = () => {
    throw new Error('the SDK surface test must not make a network request');
  };
  const cloud = new Client({
    apiKey: 'rc_test_offline_surface_check',
    apiUrl: 'https://offline.invalid',
    fetch: rejectNetwork,
  });

  assert.equal(typeof cloud.account, 'function');
  assert.equal(typeof cloud.assets.upload, 'function');
  assert.equal(typeof cloud.assets.delete, 'function');
  for (const platform of ['ios', 'android']) {
    for (const method of [
      'create',
      'get',
      'accessibilityTree',
      'tap',
      'swipe',
      'screenshot',
      'delete',
    ]) {
      assert.equal(typeof cloud[platform][method], 'function', `${platform}.${method} is unavailable`);
    }
  }
});

test('a shared app archive requires an explicitly selected platform', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(
    new URL('accessibility-benchmark/live.test.mjs', repositoryRoot),
  )], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RUN_CLOUD_API_KEY: 'rc_test_offline_configuration_check',
      RUN_CLOUD_BENCHMARK_APP: '/tmp/shared-app-archive',
      RUN_CLOUD_BENCHMARK_PLATFORM: '',
      RUN_CLOUD_BENCHMARK_RUN_ID: 'offline-configuration-check',
      RUN_CLOUD_BENCHMARK_ARTIFACT_DIR: '/tmp/run-cloud-offline-configuration-check',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /RUN_CLOUD_BENCHMARK_APP requires RUN_CLOUD_BENCHMARK_PLATFORM/,
  );
});

test('the contract validator enforces both platform hierarchies and every documented state', () => {
  for (const platform of ['ios', 'android']) {
    for (const stateName of Object.keys(benchmarkContract.states)) {
      const tree = fixtureTree(platform, stateName);
      const selected = assertBenchmarkTree(tree, platform, stateName);
      assert.deepEqual(Object.keys(selected), benchmarkContract.hierarchy.depthFirstOrder);
      const exposedSecret = structuredClone(tree);
      const password = exposedSecret.roots[0].children[0].children.find(
        (node) => node.id === `${platform}-password`,
      );
      assert.ok(password, `${platform} fixture omitted the password node`);
      password.value = benchmarkContract.forbiddenAccessibleText;
      assert.throws(
        () => assertBenchmarkTree(exposedSecret, platform, stateName),
        /secure fixture text escaped/,
      );
    }
  }
});

function fixtureTree(platform, stateName) {
  const state = benchmarkContract.states[stateName];
  const labels = {
    heading: 'ACCESSIBILITY PROOF',
    nestedLabel: state.nestedLabel,
    status: state.status,
    name: 'Name',
    password: 'Password',
    toggle: 'Notifications',
    disabled: 'Submit',
    navigate: state.navigationLabel,
  };
  const roles = Object.fromEntries(
    Object.entries(benchmarkContract.nodes).map(([name, node]) => [name, node.roles[platform][0]]),
  );
  const controls = benchmarkContract.hierarchy.depthFirstOrder.map((name, index) => ({
    id: `${platform}-${name}`,
    path: `0.0.${index}`,
    role: roles[name],
    label: labels[name],
    value: name === 'name' ? 'Ada' : null,
    identifier: platform === 'ios' ? benchmarkContract.nodes[name].iosIdentifier ?? null : null,
    bounds: { x: 10, y: 20 + index * 45, width: 200, height: 40 },
    states: {
      enabled: name !== 'disabled',
      focused: false,
      selected: null,
      checked: name === 'toggle' ? state.toggleChecked : null,
      expanded: null,
      focusable: true,
      clickable: ['toggle', 'disabled', 'navigate'].includes(name),
      scrollable: false,
      editable: name === 'name' || name === 'password',
      secure: name === 'password',
    },
    native: platform === 'ios'
      ? { platform, type: null }
      : {
          platform,
          className: name === 'toggle' ? 'android.widget.Switch' : 'android.view.View',
        },
    children: [],
  }));
  const group = {
    id: `${platform}-group`,
    path: '0.0',
    role: 'group',
    label: 'Accessibility proof group',
    value: null,
    identifier: null,
    bounds: { x: 0, y: 0, width: 300, height: 500 },
    states: {
      enabled: true,
      focused: false,
      selected: null,
      checked: null,
      expanded: null,
      focusable: false,
      clickable: false,
      scrollable: false,
      editable: false,
      secure: false,
    },
    native: { platform },
    children: controls,
  };
  const root = {
    ...group,
    id: `${platform}-root`,
    path: '0',
    role: platform === 'ios' ? 'application' : 'window',
    children: [group],
  };
  return {
    schemaVersion: 1,
    platform,
    capturedAt: '2026-08-11T00:00:00.000Z',
    screen: { width: 390, height: 844, unit: platform === 'ios' ? 'points' : 'pixels' },
    nodeCount: 2 + benchmarkContract.hierarchy.depthFirstOrder.length,
    truncated: false,
    roots: [root],
  };
}
