import assert from 'node:assert/strict';

export const fingerprints = {
  camera: 'RCAM-v1:RGBY',
  microphone: 'RAUD-v1:1000Hz',
};

export function flattenAccessibilityTree(tree) {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of tree.roots ?? []) visit(root);
  return nodes;
}

export function mediaStatus(tree) {
  const node = flattenAccessibilityTree(tree).find((candidate) =>
    candidate.identifier === 'media-proof-status'
      || candidate.native?.contentDescription?.startsWith('media-proof-status '),
  );
  if (!node) return null;
  const values = [node.label, node.value, node.native?.contentDescription]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => value.replace(/^media-proof-status\s+/, ''));
  return [...new Set(values)].join(' ');
}

export function isExpectedPreInjectionStatus(status, { platform, input, attempt }) {
  if (platform !== 'ios' || typeof status !== 'string' || !status.includes(`attempt=${attempt}`)) {
    return false;
  }
  return input === 'camera'
    ? status.includes('CAMERA FAIL code=camera-unavailable')
    : input === 'microphone'
      && status.includes('MICROPHONE FAIL code=microphone-format');
}

export function isRetryableAccessibilityFailure(error) {
  return error?.retryable === true
    && error?.code === 'accessibility_unavailable'
    && error?.action === 'accessibility';
}

export function permissionButton(tree) {
  const nodes = flattenAccessibilityTree(tree);
  const allowedLabels = [
    /^allow$/i,
    /^while using the app$/i,
    /^only this time$/i,
    /^open$/i,
  ];
  return nodes.find((node) => {
    if (!node.bounds || node.states?.enabled === false) return false;
    const labels = [node.label, node.value, node.native?.contentDescription]
      .filter((value) => typeof value === 'string');
    return labels.some((label) => allowedLabels.some((pattern) => pattern.test(label.trim())));
  }) ?? null;
}

export function normalizedCenter(tree, node) {
  assert.ok(node.bounds, 'permission button omitted bounds');
  return {
    x: (node.bounds.x + node.bounds.width / 2) / tree.screen.width,
    y: (node.bounds.y + node.bounds.height / 2) / tree.screen.height,
  };
}

export function assertMediaPass(status, input, attempt) {
  assert.ok(status, `app omitted the ${input} proof status`);
  assert.match(status, new RegExp(`\\b${input.toUpperCase()} PASS\\b`));
  assert.ok(status.includes(fingerprints[input]), `${input} fingerprint did not match`);
  assert.ok(status.includes(`attempt=${attempt}`), `${input} proof came from another attempt`);
  if (input === 'camera') {
    assert.match(status, /\bframes=\d+\b/);
    assert.match(status, /\bmatches=[3-9]\d*\b/);
  } else {
    assert.match(status, /\bsamples=\d+\b/);
    assert.match(status, /\bmeasured=(?:9\d\d|10\d\d)Hz\b/);
  }
}
