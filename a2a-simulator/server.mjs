import { startConnector } from './connector.mjs';

const server = await startConnector({
  port: Number(process.env.PORT ?? 3100),
  apiUrl: process.env.RUN_CLOUD_API_URL ?? 'https://api.run.cloud',
});
console.log(`A2A connector: ${server.baseUrl}/.well-known/agent-card.json`);
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await server.close();
  process.exit(0);
});
