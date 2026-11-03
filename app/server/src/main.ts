import path from 'node:path';
import { buildApp } from './index.ts';
import { loadConnections, openaiChat } from './store.ts';

const dataDir = path.resolve(process.env.AGENTVIEW_DATA ?? path.join(import.meta.dirname, '../../data'));
// ponytail: connections load once at start; reload-on-change arrives with the model admin screen (stage 3)
const app = buildApp({ dataDir, chat: openaiChat(await loadConnections(dataDir)) });
const port = Number(process.env.PORT ?? 8787);
await app.listen({ host: '127.0.0.1', port });
console.log(`AgentView server on http://127.0.0.1:${port} (data: ${dataDir})`);
