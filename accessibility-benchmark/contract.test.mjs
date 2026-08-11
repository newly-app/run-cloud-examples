import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

test('the contract validator enforces both platform hierarchies and every documented state', () => {
  for (const platform of ['ios', 'android']) {
    for (const stateName of Object.keys(benchmarkContract.states)) {
      const tree = fixtureTree(platform, stateName);
      const selected = assertBenchmarkTree(tree, platform, stateName);
      assert.deepEqual(Object.keys(selected), benchmarkContract.hierarchy.depthFirstOrder);
      const exposedSecret = structuredClone(tree);
      exposedSecret.roots[0].children[0].children[4].value =
        benchmarkContract.forbiddenAccessibleText;
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
    nodeCount: 10,
    truncated: false,
    roots: [root],
  };
}
