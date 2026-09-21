import { randomUUID } from 'node:crypto';
import express from 'express';
import { AgentCard, Message } from '@a2a-js/sdk';
import { AgentEvent, DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler } from '@a2a-js/sdk/server/express';
import { Client } from '@run-cloud/sdk';

const operations = ['account', 'usage', 'create', 'get', 'open-url', 'accessibility', 'tap', 'press-button', 'screenshot', 'delete'];
class InvalidInput extends Error {}

export function createAgentCard(baseUrl) {
  return AgentCard.fromJSON({
    name: 'run.cloud simulators',
    description: 'Create, inspect, interact with, and release billed mobile simulator sessions using your run.cloud credential.',
    version: '0.1.0',
    supportedInterfaces: [{ url: `${baseUrl}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    provider: { organization: 'run.cloud', url: 'https://run.cloud' },
    capabilities: {},
    securitySchemes: {
      runcloud: { httpAuthSecurityScheme: {
        scheme: 'Bearer', bearerFormat: 'run.cloud API key',
        description: 'Sign up at https://run.cloud/login or use runcloud login --email. Supply your own API key in the Authorization header.',
      } },
    },
    securityRequirements: [{ schemes: { runcloud: { list: [] } } }],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json', 'image/png'],
    skills: [{
      id: 'simulators', name: 'Mobile simulators',
      description: `Send one data part with operation (${operations.join(', ')}). Session operations require platform (ios or android); existing sessions require sessionId. Create requires idempotencyKey and optionally orgId. Tap requires normalized x/y. Press-button requires button (home). Sessions have a fixed 5-minute hard limit.`,
      tags: ['ios', 'android', 'simulator'],
      examples: ['{"operation":"account"}', '{"operation":"create","platform":"ios","idempotencyKey":"unique-request-id"}'],
    }],
  });
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new InvalidInput(`${name} must be a nonempty string of at most 200 characters`);
  }
  return value;
}

export async function runOperation(cloud, input) {
  if (!input || Array.isArray(input) || !operations.includes(input.operation)) {
    throw new InvalidInput(`operation must be one of: ${operations.join(', ')}`);
  }
  if (input.operation === 'account') {
    const account = await cloud.credential();
    return { data: { authenticated: true, products: account.products, orgs: account.orgs } };
  }
  if (input.operation === 'usage') {
    return { data: await cloud.usage(input.orgId ? { orgId: requireString(input.orgId, 'orgId') } : {}) };
  }
  if (!['ios', 'android'].includes(input.platform)) throw new InvalidInput('platform must be ios or android');
  const mobile = cloud[input.platform];
  if (input.operation === 'create') {
    return { data: await mobile.create({
      idempotencyKey: requireString(input.idempotencyKey, 'idempotencyKey'),
      ...(input.orgId ? { orgId: requireString(input.orgId, 'orgId') } : {}),
      inactivityTimeout: '60s', hardTimeout: '5m',
      displayName: 'A2A simulator', tags: { client: 'a2a' },
    }) };
  }
  const id = requireString(input.sessionId, 'sessionId');
  switch (input.operation) {
    case 'open-url': {
      const url = requireString(input.url, 'url');
      if (!/^https?:\/\//i.test(url)) throw new InvalidInput('url must use http or https');
      return { data: await mobile.openUrl(id, url) };
    }
    case 'accessibility': return { data: await mobile.accessibilityTree(id) };
    case 'get': return { data: await mobile.get(id) };
    case 'delete': return { data: await mobile.delete(id) };
    case 'screenshot': return { png: await mobile.screenshot(id) };
    case 'tap': {
      if (![input.x, input.y].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) {
        throw new InvalidInput('x and y must be numbers between 0 and 1');
      }
      return { data: await mobile.tap(id, { x: input.x, y: input.y }) };
    }
    case 'press-button': {
      if (input.button !== 'home') throw new InvalidInput('button must be home');
      return { data: await mobile.pressButton(id, 'home') };
    }
  }
}

export function createConnector({ baseUrl, apiUrl = 'https://api.run.cloud', clientFactory } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const card = createAgentCard(baseUrl);
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: async () => AgentCard.toJSON(card) }));
  app.use('/a2a', express.json({ limit: '32kb' }));
  app.use('/a2a', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
    if (!match) return res.status(401).set('WWW-Authenticate', 'Bearer realm="run.cloud"').json({ error: 'Authentication required' });
    try {
      // Each request uses only its caller's credential. Never fall back to a server API key.
      const cloud = clientFactory ? clientFactory(match[1]) : new Client({ apiKey: match[1], apiUrl });
      const account = await cloud.credential();
      req.runcloud = { cloud, userId: account.userId };
      next();
    } catch (error) {
      const status = error.status === 401 || error.status === 403 ? error.status : 503;
      if (status === 401) res.set('WWW-Authenticate', 'Bearer realm="run.cloud"');
      res.status(status).json({ error: status === 503 ? 'Authentication service unavailable' : 'Credential rejected' });
    }
  });
  app.use('/a2a', (req, res, next) => {
    const executor = {
      async execute(context, bus) {
        let parts;
        try {
          const input = context.userMessage.parts;
          if (input.length !== 1 || input[0].content?.$case !== 'data') {
            throw new InvalidInput('Send exactly one structured data part; see the agent card for supported operations');
          }
          const result = await runOperation(req.runcloud.cloud, input[0].content.value);
          parts = result.png
            ? [{ content: { $case: 'raw', value: Buffer.from(result.png) }, mediaType: 'image/png', filename: 'simulator.png' }]
            : [{ content: { $case: 'data', value: { ok: true, result: result.data } } }];
        } catch (error) {
          // Upstream error messages can contain signed URLs. Return only bounded metadata.
          parts = [{ content: { $case: 'data', value: {
            ok: false, error: {
              code: error instanceof InvalidInput ? 'invalid_request' : typeof error.status === 'number' ? `upstream_${error.status}` : 'upstream_failure',
              message: error instanceof InvalidInput ? error.message : 'run.cloud could not complete the operation',
            },
          } } }];
        }
        bus.publish(AgentEvent.message({
          ...Message.fromJSON({ messageId: randomUUID(), contextId: context.contextId, role: 'ROLE_AGENT' }), parts,
        }));
        bus.finished();
      },
      async cancelTask() { throw new Error('This connector returns messages, not persistent tasks'); },
    };
    // No conversation or task state survives the HTTP request, including signed session URLs.
    const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor);
    return jsonRpcHandler({
      requestHandler: handler,
      userBuilder: async () => ({ isAuthenticated: true, userName: req.runcloud.userId }),
    })(req, res, next);
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request' });
  });
  return app;
}

export async function startConnector(options = {}) {
  let app;
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => app(req, res));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  app = createConnector({ ...options, baseUrl });
  return { baseUrl, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
