import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const benchmarkContract = JSON.parse(
  await readFile(new URL('./contract.v1.json', import.meta.url), 'utf8'),
);

export function flattenAccessibilityTree(tree) {
  const nodes = [];
  const visit = (node, expectedPath) => {
    assert.equal(node.path, expectedPath, `accessibility path must be ${expectedPath}`);
    nodes.push(node);
    assert.ok(Array.isArray(node.children), `${expectedPath} children must be an array`);
    node.children.forEach((child, index) => visit(child, `${expectedPath}.${index}`));
  };
  assert.ok(Array.isArray(tree.roots), 'accessibility roots must be an array');
  tree.roots.forEach((root, index) => visit(root, String(index)));
  return nodes;
}

export function findBenchmarkNode(tree, platform, name) {
  const expected = benchmarkContract.nodes[name];
  assert.ok(expected, `unknown benchmark node ${name}`);
  const nodes = flattenAccessibilityTree(tree);

  if (platform === 'ios' && expected.iosIdentifier) {
    return nodes.find((node) => node.identifier === expected.iosIdentifier);
  }
  if (platform === 'android' && expected.androidClassContains) {
    return nodes.find((node) =>
      expected.labels.includes(node.label)
      && node.native?.className?.toLowerCase().includes(expected.androidClassContains),
    );
  }
  return nodes.find((node) => expected.labels.includes(node.label));
}

export function requireBenchmarkNode(tree, platform, name) {
  const node = findBenchmarkNode(tree, platform, name);
  assert.ok(node, `${platform} accessibility tree omitted ${name}`);
  return node;
}

export function assertBenchmarkTree(tree, platform, stateName) {
  const expectedState = benchmarkContract.states[stateName];
  assert.ok(expectedState, `unknown benchmark state ${stateName}`);
  assert.equal(tree.schemaVersion, 1);
  assert.equal(tree.platform, platform);
  assert.equal(tree.screen.unit, platform === 'ios' ? 'points' : 'pixels');
  assert.ok(tree.screen.width > 0 && tree.screen.height > 0);
  assert.ok(Number.isFinite(Date.parse(tree.capturedAt)));
  assert.equal(tree.truncated, false);

  const nodes = flattenAccessibilityTree(tree);
  assert.equal(nodes.length, tree.nodeCount);
  assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length);
  assert.equal(
    JSON.stringify(tree).includes(benchmarkContract.forbiddenAccessibleText),
    false,
    'secure fixture text escaped into the accessibility tree',
  );

  const selected = Object.fromEntries(
    benchmarkContract.hierarchy.depthFirstOrder.map((name) => [
      name,
      requireBenchmarkNode(tree, platform, name),
    ]),
  );
  for (const [name, node] of Object.entries(selected)) {
    const expected = benchmarkContract.nodes[name];
    assert.ok(expected.roles[platform].includes(node.role), `${platform} ${name} role was ${node.role}`);
    assert.ok(node.bounds, `${platform} ${name} omitted bounds`);
    assert.ok(node.bounds.width > 0 && node.bounds.height > 0, `${platform} ${name} has empty bounds`);
    assert.equal(node.native.platform, platform);
  }

  assert.equal(selected.name.value, benchmarkContract.nodes.name.value);
  assert.equal(selected.name.states.editable, true);
  assert.equal(selected.name.states.secure, false);
  assert.equal(selected.password.value, null);
  assert.equal(selected.password.states.editable, true);
  assert.equal(selected.password.states.secure, true);
  assert.equal(selected.disabled.states.enabled, false);
  assert.equal(selected.navigate.states.enabled, true);
  assert.equal(selected.nestedLabel.label, expectedState.nestedLabel);
  assert.equal(selected.status.label, expectedState.status);
  assert.equal(selected.toggle.states.checked, expectedState.toggleChecked);
  assert.equal(selected.navigate.label, expectedState.navigationLabel);

  const depthFirstPositions = benchmarkContract.hierarchy.depthFirstOrder.map((name) =>
    nodes.indexOf(selected[name]),
  );
  assert.deepEqual(
    depthFirstPositions,
    [...depthFirstPositions].sort((left, right) => left - right),
    `${platform} benchmark controls were not returned in documented depth-first order`,
  );
  assert.equal(
    new Set(Object.values(selected).map((node) => node.path.split('.')[0])).size,
    1,
    `${platform} benchmark controls did not share one native tree root`,
  );

  if (platform === 'ios' && benchmarkContract.hierarchy.iosApplicationRoot) {
    const application = nodes.find((node) => node.role === 'application');
    assert.ok(application, 'iOS accessibility tree omitted the application root');
    assert.ok(
      Object.values(selected).every((node) => node.path.startsWith(`${application.path}.`)),
      'iOS benchmark controls were not descendants of the application root',
    );
  }
  if (platform === 'android') {
    assert.ok(
      Object.values(selected).some(
        (node) => node.path.split('.').length >= benchmarkContract.hierarchy.androidMinimumPathSegments,
      ),
      'Android benchmark controls were not returned in the documented nested hierarchy',
    );
  }
  return selected;
}

export function normalizedCenter(tree, node) {
  assert.ok(node.bounds, `${node.label ?? node.identifier ?? node.role} omitted bounds`);
  return {
    x: (node.bounds.x + node.bounds.width / 2) / tree.screen.width,
    y: (node.bounds.y + node.bounds.height / 2) / tree.screen.height,
  };
}

export function isVisiblePoint(point) {
  return point.x >= 0.02 && point.x <= 0.98 && point.y >= 0.08 && point.y <= 0.92;
}
