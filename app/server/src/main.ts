import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { createDb, DEFAULT_DB_URL } from './db.ts';
import { buildApp } from './index.ts';
import { stopLeftoverSandboxes } from './sandbox.ts';
import { loadConnections, openaiChat } from './store.ts';

const dataDir = path.resolve(process.env.AGENTVIEW_DATA ?? path.join(import.meta.dirname, '../../data'));
// Runs work without the database; only saved sessions need it.
const db = await createDb(process.env.DATABASE_URL ?? DEFAULT_DB_URL).catch((e: Error) => {
  console.warn(`database unavailable, sessions are off (${e.message}). Start it with: npm run db`);
  return null;
});
// ponytail: connections load once at start; reload-on-change arrives with the model connection screen
const app = buildApp({ dataDir, chat: openaiChat(await loadConnections(dataDir)), db });
app.addHook('onClose', async () => { await db?.close(); });
// Serve the built web (npm run build -w @agentview/web) from the same origin, for the tunnel.
const webDist = path.join(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) await app.register(fastifyStatic, { root: webDist });
void stopLeftoverSandboxes();
const port = Number(process.env.PORT ?? 8787);
await app.listen({ host: '127.0.0.1', port });
console.log(`AgentView server on http://127.0.0.1:${port} (data: ${dataDir}, sessions: ${db ? 'on' : 'off'})`);
