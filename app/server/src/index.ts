import path from 'node:path';
import Fastify, { type FastifyReply } from 'fastify';
import { createBus, RUN_ID, type Ev } from './events.ts';
import { startRun, type AgUiMessage, type Deps } from './runner.ts';
import { runInSandbox } from './sandbox.ts';
import { listAgents, loadAgent, type ChatFn } from './store.ts';
import { runTool, toolDefs, type ExecFn } from './tools.ts';

const ID = RUN_ID.source;
const TARGET = '^agent:[a-z0-9][a-z0-9-]{0,40}$';
const RUN_TIMEOUT_MS = 600_000;
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: ID } } };

function sse(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  return (id: string, e: Ev) => { reply.raw.write(`id: ${id}\ndata: ${JSON.stringify(e)}\n\n`); };
}

export function buildApp(opts: { dataDir: string; chat: ChatFn; exec?: ExecFn }) {
  const app = Fastify();
  const bus = createBus(path.join(opts.dataDir, 'runs'));
  const running = new Map<string, AbortController>();
  const exec: ExecFn = opts.exec ?? ((agent, command, timeoutSec, signal) => runInSandbox(agent, opts.dataDir, command, timeoutSec, signal));
  const deps: Deps = {
    chat: opts.chat,
    toolDefs,
    runTool: (agent, name, args, signal) => runTool(agent, name, args, signal, { dataDir: opts.dataDir, exec }),
  };

  app.get('/agents', async () => (await listAgents(opts.dataDir)).map(({ id, name, role, avatar }) => ({ id, name, role, avatar })));

  app.post('/agui', {
    schema: {
      body: {
        type: 'object',
        required: ['threadId', 'runId', 'messages', 'forwardedProps'],
        properties: {
          threadId: { type: 'string', pattern: ID },
          runId: { type: 'string', pattern: ID },
          messages: { type: 'array', maxItems: 500, items: { type: 'object', required: ['role'], properties: { role: { enum: ['user', 'assistant', 'system', 'developer', 'tool'] } } } },
          forwardedProps: { type: 'object', required: ['target'], properties: { target: { type: 'string', pattern: TARGET } } },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { threadId: string; runId: string; messages: AgUiMessage[]; forwardedProps: { target: string } };
    if (bus.exists(body.runId)) return reply.code(409).send({ error: 'runId already used' });
    const agent = await loadAgent(opts.dataDir, body.forwardedProps.target.slice('agent:'.length)).catch(() => null);
    if (!agent) return reply.code(404).send({ error: 'agent not found' });
    const ac = new AbortController();
    running.set(body.runId, ac);
    const write = sse(reply);
    const off = bus.follow(body.runId, -1, (seq, e) => write(String(seq), e), () => reply.raw.end());
    reply.raw.on('close', off); // the run keeps going if the client disconnects
    void startRun({ ...body, agent }, deps, (e) => bus.emit(body.runId, e), AbortSignal.any([ac.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]))
      .finally(() => running.delete(body.runId));
  });

  app.get('/runs', async () => bus.list());

  app.get('/runs/:id/events', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!bus.exists(id)) return reply.code(404).send({ error: 'run not found' });
    const lastId = Number(req.headers['last-event-id']);
    const write = sse(reply);
    const off = bus.follow(id, Number.isInteger(lastId) ? lastId : -1, (seq, e) => write(String(seq), e), () => reply.raw.end());
    reply.raw.on('close', off);
  });

  app.get('/events', async (_req, reply) => {
    const write = sse(reply);
    const off = bus.followAll((runId, seq, e) => write(`${runId}:${seq}`, e));
    reply.raw.on('close', off);
  });

  app.post('/runs/:id/cancel', { schema: { params: idParams } }, async (req, reply) => {
    const ac = running.get((req.params as { id: string }).id);
    if (!ac) return reply.code(404).send({ error: 'run is not in progress' });
    ac.abort();
    return reply.code(202).send({ ok: true });
  });

  return app;
}
