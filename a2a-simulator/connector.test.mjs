import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunCloudError } from '@run-cloud/sdk';
import { startConnector } from './connector.mjs';
import { connect } from './client.mjs';

test('official A2A client discovers auth and drives only the caller’s simulator', async t => {
  const calls = [];
  const sessions = new Map();
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const server = await startConnector({ clientFactory: token => {
    const own = id => {
      if (sessions.get(id)?.owner !== token) throw new RunCloudError(404, 'not found');
      return sessions.get(id);
    };
    return {
      credential: async () => {
        if (!['alice', 'bob'].includes(token)) throw new RunCloudError(401, 'invalid secret');
        return { userId: token, products: ['run_cloud'], orgs: [token], runCloud: true };
      },
      ios: {
        create: async options => {
          calls.push({ token, options });
          const session = { id: `sim-${token}`, owner: token, status: 'active' };
          sessions.set(session.id, session);
          return session;
        },
        get: async id => own(id),
        screenshot: async id => { own(id); return png; },
        tap: async (id, args) => { own(id); return { status: 'completed', ...args }; },
        delete: async id => { own(id).status = 'released'; return { id, status: 'released' }; },
      },
    };
  } });
  t.after(() => server.close());
  const card = await (await fetch(`${server.baseUrl}/.well-known/agent-card.json`)).json();
  assert.equal(card.supportedInterfaces[0].protocolBinding, 'JSONRPC');
  assert.equal(card.securitySchemes.runcloud.httpAuthSecurityScheme.scheme, 'Bearer');
  assert.equal(JSON.stringify(card).includes('alice'), false);

  const missing = await fetch(`${server.baseUrl}/a2a`, { method: 'POST' });
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate'), /Bearer/);
  const invalid = await connect(server.baseUrl, 'bad');
  await assert.rejects(invalid({ operation: 'account' }));
  assert.equal(calls.length, 0);

  const alice = await connect(server.baseUrl, 'alice');
  const bob = await connect(server.baseUrl, 'bob');
  assert.equal((await alice({ operation: 'account' })).authenticated, true);
  const session = await alice({ operation: 'create', platform: 'ios', idempotencyKey: 'proof-create' });
  assert.equal(session.id, 'sim-alice');
  assert.equal(calls[0].options.hardTimeout, '5m');
  assert.equal(calls[0].options.idempotencyKey, 'proof-create');
  await assert.rejects(bob({ operation: 'get', platform: 'ios', sessionId: session.id }), { code: 'upstream_404' });
  const shot = await alice({ operation: 'screenshot', platform: 'ios', sessionId: session.id });
  assert.deepEqual(shot.png, png);
  assert.equal((await alice({ operation: 'tap', platform: 'ios', sessionId: session.id, x: 0.5, y: 0.3 })).status, 'completed');
  await assert.rejects(alice({ operation: 'tap', platform: 'ios', sessionId: session.id, x: 2, y: 0 }), { code: 'invalid_request' });
  await assert.rejects(alice({ operation: 'sandbox.create' }), { code: 'invalid_request' });
  await assert.rejects(alice({ operation: 'create', platform: 'ios' }), { code: 'invalid_request' });
  assert.equal((await alice({ operation: 'delete', platform: 'ios', sessionId: session.id })).status, 'released');
});

test('authentication outages fail closed with 503, without exposing upstream errors', async t => {
  const server = await startConnector({ clientFactory: () => ({
    credential: async () => { throw new RunCloudError(500, 'secret https://example.test/?token=private'); },
  }) });
  t.after(() => server.close());
  const response = await fetch(`${server.baseUrl}/a2a`, { method: 'POST', headers: { Authorization: 'Bearer test' } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Authentication service unavailable' });
});
