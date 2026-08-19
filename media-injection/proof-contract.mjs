import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const fingerprints = {
  camera: 'RCAM-v1:RGBY',
  microphone: 'RAUD-v1:1000Hz',
};

const retryableAccessibilityCodes = new Set([
  'accessibility_unavailable',
  'accessibility_transport_error',
  'accessibility_timeout',
]);

const iosDeepLinkConfirmationPoint = Object.freeze({ x: 0.69, y: 0.535 });

export function boundedRequestId(...segments) {
  const candidate = segments
    .map((segment) => String(segment))
    .join(':')
    .replace(/[^A-Za-z0-9._:-]/g, '-');
  assert.ok(candidate.length > 0, 'request ID has no usable characters');
  if (candidate.length <= 128) return candidate;
  const suffix = createHash('sha256').update(candidate).digest('hex').slice(0, 16);
  return `${candidate.slice(0, 111)}:${suffix}`;
}

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
    && retryableAccessibilityCodes.has(error?.code)
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

export function deepLinkConfirmationPoint(platform, status, alreadyTapped) {
  if (platform !== 'ios' || status !== null || alreadyTapped) return null;
  return iosDeepLinkConfirmationPoint;
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
    const matchingFrames = status.match(/\bmatches=(\d+)\b/);
    assert.ok(matchingFrames, 'camera proof omitted its matching frame count');
    assert.ok(Number(matchingFrames[1]) >= 3, 'camera proof reported fewer than three matching frames');
  } else {
    assert.match(status, /\bsamples=\d+\b/);
    assert.match(status, /\bmeasured=(?:9\d\d|10\d\d)Hz\b/);
  }
}
