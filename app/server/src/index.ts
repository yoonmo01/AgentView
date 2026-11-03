import path from 'node:path';
import Fastify, { type FastifyReply } from 'fastify';
import { createBus, RUN_ID, type Ev } from './events.ts';
import { startRun, type AgUiMessage, type Deps } from './runner.ts';
import { listFiles, readFile, removeContainer, runInSandbox, workspaceDir } from './sandbox.ts';
import {
  AGENT_ID, agentExists, assignRoom, checkAgent, checkTeam, deleteAgent, deleteTeam, listAgents, listTeams, loadConnections,
  resolve, saveAgent, saveTeam, teamExists, teamWithDefaults, withDefaults, type Agent, type ChatFn, type Team,
} from './store.ts';
import { listTools, runTool, toolDefs, type ExecFn } from './tools.ts';

const ID = RUN_ID.source;
const TARGET = '^(agent|team):[a-z0-9][a-z0-9-]{0,40}$';
const RUN_TIMEOUT_MS = 600_000;
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: ID } } };
const agentParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: AGENT_ID.source } } };
const AGENT_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'connection'],
  properties: {
    id: { type: 'string', pattern: AGENT_ID.source },
    name: { type: 'string', minLength: 1, maxLength: 60 },
    role: { type: 'string', maxLength: 200 },
    connection: { type: 'string', minLength: 1, maxLength: 64 },
    model: { type: 'string', maxLength: 100 },
    systemPrompt: { type: 'string', maxLength: 20_000 },
    tools: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' } },
    // the image name goes to `docker run` as an argument, so it must not look like a flag
    sandbox: { type: 'object', additionalProperties: false, required: ['image', 'network'], properties: {
      image: { type: 'string', pattern: '^[a-z0-9][a-z0-9._/:@-]{0,200}$' }, network: { type: 'boolean' } } },
    avatar: { type: 'object', additionalProperties: false, required: ['model', 'color'], properties: {
      model: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,60}\\.glb$' }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } } },
    maxSteps: { type: 'integer', minimum: 1, maximum: 20 },
  },
};
const TEAM_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'pattern', 'main', 'members'],
  properties: {
    id: { type: 'string', pattern: AGENT_ID.source },
    name: { type: 'string', minLength: 1, maxLength: 60 },
    pattern: { enum: ['supervisor', 'parallel', 'debate'] },
    main: { type: 'string', pattern: AGENT_ID.source },
    members: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', pattern: '^(team:)?[a-z0-9][a-z0-9-]{0,40}$' } },
    limits: { type: 'object', additionalProperties: false, properties: {
      maxDepth: { type: 'integer', minimum: 1, maximum: 5 },
      maxCalls: { type: 'integer', minimum: 1, maximum: 200 },
      timeoutSec: { type: 'integer', minimum: 10, maximum: 3600 },
      rounds: { type: 'integer', minimum: 1, maximum: 5 },
    } },
    room: {}, // assigned by the server; any client value is ignored
  },
};

function sse(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  return (id: string, e: Ev) => { reply.raw.write(`id: ${id}\ndata: ${JSON.stringify(e)}\n\n`); };
}

export function buildApp(opts: { dataDir: string; chat: ChatFn; exec?: ExecFn; removeSandbox?: (agentId: string) => Promise<void> }) {
  const app = Fastify();
  const bus = createBus(path.join(opts.dataDir, 'runs'));
  const running = new Map<string, AbortController>();
  const exec: ExecFn = opts.exec ?? ((agent, command, timeoutSec, signal) => runInSandbox(agent, opts.dataDir, command, timeoutSec, signal));
  const deps: Deps = {
    chat: opts.chat,
    toolDefs,
    runTool: (agent, name, args, signal) => runTool(agent, name, args, signal, { dataDir: opts.dataDir, exec }),
  };

  // Agent definitions hold no secrets (keys stay in env), so the admin screen gets them whole.
  app.get('/agents', async () => listAgents(opts.dataDir));

  async function save(id: string, body: Partial<Agent>, reply: FastifyReply, code: number) {
    const agent = withDefaults(body, id);
    const error = checkAgent(agent, {
      connections: (await loadConnections(opts.dataDir)).map((c) => c.id),
      tools: listTools().map((t) => t.name),
    });
    if (error) return reply.code(400).send({ error });
    await saveAgent(opts.dataDir, agent);
    return reply.code(code).send(agent);
  }

  app.post('/agents', { schema: { body: { ...AGENT_BODY, required: ['id', ...AGENT_BODY.required] } } }, async (req, reply) => {
    const body = req.body as Agent;
    if (agentExists(opts.dataDir, body.id)) return reply.code(409).send({ error: 'agent already exists' });
    return save(body.id, body, reply, 201);
  });

  app.put('/agents/:id', { schema: { params: agentParams, body: AGENT_BODY } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!agentExists(opts.dataDir, id)) return reply.code(404).send({ error: 'agent not found' });
    return save(id, req.body as Partial<Agent>, reply, 200);
  });

  app.delete('/agents/:id', { schema: { params: agentParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!agentExists(opts.dataDir, id)) return reply.code(404).send({ error: 'agent not found' });
    const user = (await listTeams(opts.dataDir)).find((t) => t.main === id || t.members.includes(id));
    if (user) return reply.code(409).send({ error: `used by team ${user.id}` });
    await deleteAgent(opts.dataDir, id);
    await (opts.removeSandbox ?? removeContainer)(id).catch(() => {}); // workspace files stay on the host
    return reply.code(204).send();
  });

  app.get('/agents/:id/files', { schema: { params: agentParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!agentExists(opts.dataDir, id)) return reply.code(404).send({ error: 'agent not found' });
    return listFiles(workspaceDir(opts.dataDir, id));
  });

  app.get('/agents/:id/files/*', { schema: { params: agentParams } }, async (req, reply) => {
    const { id, '*': rel } = req.params as { id: string; '*': string };
    if (!agentExists(opts.dataDir, id)) return reply.code(404).send({ error: 'agent not found' });
    try {
      const text = await readFile(workspaceDir(opts.dataDir, id), rel);
      return reply.type('text/plain; charset=utf-8').send(text);
    } catch (e) {
      return reply.code((e as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400).send({ error: (e as Error).message });
    }
  });

  app.get('/teams', async () => listTeams(opts.dataDir));

  async function saveT(id: string, body: Partial<Team>, reply: FastifyReply, code: number) {
    const teams = await listTeams(opts.dataDir);
    const team = teamWithDefaults({ ...body, room: null }, id);
    const error = checkTeam(team, new Set((await listAgents(opts.dataDir)).map((a) => a.id)), new Map(teams.map((t) => [t.id, t])));
    if (error) return reply.code(400).send({ error });
    team.room = assignRoom(team, teams);
    await saveTeam(opts.dataDir, team);
    return reply.code(code).send(team);
  }

  app.post('/teams', { schema: { body: { ...TEAM_BODY, required: ['id', ...TEAM_BODY.required] } } }, async (req, reply) => {
    const body = req.body as Team;
    if (teamExists(opts.dataDir, body.id)) return reply.code(409).send({ error: 'team already exists' });
    return saveT(body.id, body, reply, 201);
  });

  app.put('/teams/:id', { schema: { params: agentParams, body: TEAM_BODY } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!teamExists(opts.dataDir, id)) return reply.code(404).send({ error: 'team not found' });
    return saveT(id, req.body as Partial<Team>, reply, 200);
  });

  app.delete('/teams/:id', { schema: { params: agentParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!teamExists(opts.dataDir, id)) return reply.code(404).send({ error: 'team not found' });
    const user = (await listTeams(opts.dataDir)).find((t) => t.members.includes(`team:${id}`));
    if (user) return reply.code(409).send({ error: `used by team ${user.id}` });
    await deleteTeam(opts.dataDir, id); // frees its room; the shared folder stays on the host
    return reply.code(204).send();
  });

  app.get('/models', async () =>
    (await loadConnections(opts.dataDir)).map(({ id, baseURL, defaultModel, maxTokens }) => ({ id, baseURL, defaultModel, maxTokens })));

  app.get('/tools', async () => listTools());

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
    const target = body.forwardedProps.target;
    const defs = await resolve(opts.dataDir, target).catch(() => null);
    if (!defs) return reply.code(404).send({ error: `${target} not found, or one of its members is missing` });
    const team = target.startsWith('team:') ? defs.teams.get(target.slice('team:'.length)) : undefined;
    const ac = new AbortController();
    running.set(body.runId, ac);
    const write = sse(reply);
    const off = bus.follow(body.runId, -1, (seq, e) => write(String(seq), e), () => reply.raw.end());
    reply.raw.on('close', off); // the run keeps going if the client disconnects
    const timeout = AbortSignal.timeout(team ? team.limits.timeoutSec * 1000 : RUN_TIMEOUT_MS);
    void startRun({ ...body, target, defs }, deps, (e) => bus.emit(body.runId, e), AbortSignal.any([ac.signal, timeout]))
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
