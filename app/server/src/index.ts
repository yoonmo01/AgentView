import path from 'node:path';
import Fastify, { type FastifyReply } from 'fastify';
import type { Db } from './db.ts';
import { createBus, RUN_ID, summarizeRun, sumUsage, type Ev } from './events.ts';
import { createMcp, MCP_NAME, parseConfig, type Mcp, type McpConfig } from './mcp.ts';
import { startRun, type AgUiMessage, type Deps } from './runner.ts';
import { dockerFiles, envState, NotFound, PKG, prepareEnv, pruneEnvImages, removeContainer, removeWorkVolume, runInSandbox, type Files } from './sandbox.ts';
import {
  AGENT_ID, agentExists, assignColor, assignRoom, checkAgent, checkTeam, deleteAgent, deleteTeam, listAgents, listTeams, loadAgent, loadConnections,
  resolve, saveAgent, saveTeam, teamExists, teamWithDefaults, withDefaults, type Agent, type ChatFn, type Team,
} from './store.ts';
import { containerPath, listTools, runTool, toolDefs, type ExecFn } from './tools.ts';

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
      image: { type: 'string', pattern: '^[a-z0-9][a-z0-9._/:@-]{0,200}$' }, network: { type: 'boolean' },
      // the names go into a Dockerfile RUN line, so only package-name characters pass
      packages: { type: 'object', additionalProperties: false, properties: {
        pip: { type: 'array', maxItems: 30, uniqueItems: true, items: { type: 'string', pattern: PKG.pip.source } },
        npm: { type: 'array', maxItems: 30, uniqueItems: true, items: { type: 'string', pattern: PKG.npm.source } },
        apt: { type: 'array', maxItems: 30, uniqueItems: true, items: { type: 'string', pattern: PKG.apt.source } },
      } } } },
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
    pattern: { enum: ['supervisor', 'parallel', 'debate', 'pipeline', 'review', 'vote'] },
    main: { type: 'string', pattern: AGENT_ID.source },
    members: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', pattern: '^(team:)?[a-z0-9][a-z0-9-]{0,40}$' } },
    limits: { type: 'object', additionalProperties: false, properties: {
      maxDepth: { type: 'integer', minimum: 1, maximum: 5 },
      maxCalls: { type: 'integer', minimum: 1, maximum: 200 },
      timeoutSec: { type: 'integer', minimum: 10, maximum: 3600 },
      rounds: { type: 'integer', minimum: 1, maximum: 5 },
    } },
    room: {}, // assigned by the server; any client value is ignored
    color: { type: 'string', pattern: '^(#[0-9a-f]{6})?$' },
    roles: { type: 'object', maxProperties: 21, propertyNames: { pattern: AGENT_ID.source },
      additionalProperties: { type: 'object', additionalProperties: false, properties: { role: { type: 'string', maxLength: 200 }, instructions: { type: 'string', maxLength: 4000 } } } },
  },
};

function sse(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  return (id: string, e: Ev) => { reply.raw.write(`id: ${id}\ndata: ${JSON.stringify(e)}\n\n`); };
}

export function buildApp(opts: {
  dataDir: string; chat: ChatFn; exec?: ExecFn; files?: Files; mcp?: Mcp; db?: Db | null;
  /** removes the agent's container, and its files too when `files` */ removeSandbox?: (agentId: string, files: boolean) => Promise<void>;
  /** starts building the agent's sandbox image when it has extra packages */ prepareEnv?: (agent: Agent) => Promise<unknown>;
}) {
  const app = Fastify();
  const bus = createBus(path.join(opts.dataDir, 'runs'));
  const running = new Map<string, AbortController>();
  const exec: ExecFn = opts.exec ?? ((agent, command, timeoutSec, signal) => runInSandbox(agent, opts.dataDir, command, timeoutSec, signal));
  const files = opts.files ?? dockerFiles(opts.dataDir);
  const removeSandbox = opts.removeSandbox ?? (async (id: string, withFiles: boolean) => {
    await removeContainer(id);
    if (withFiles) await removeWorkVolume(id);
    await pruneEnvImages(await listAgents(opts.dataDir)); // its package image, unless another agent has the same setup
  });
  const mcp = opts.mcp ?? createMcp(opts.dataDir);
  void mcp.load(); // servers connect in the background; their status shows on /mcp
  app.addHook('onClose', async () => { await mcp.closeAll(); });

  async function mcpTool(allowed: string[], name: string, args: string, signal: AbortSignal): Promise<string> {
    try {
      if (!allowed.includes(name)) throw new Error(`tool not allowed for this agent: ${name}`);
      return await mcp.call(name, args, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      return `ERROR: ${(e as Error).message}`;
    }
  }
  const deps: Deps = {
    chat: opts.chat,
    toolDefs: (agent) => [...toolDefs(agent), ...mcp.defs(agent.tools)],
    runTool: (agent, name, args, signal) => name.startsWith('mcp__')
      ? mcpTool(agent.tools, name, args, signal)
      : runTool(agent, name, args, signal, { files, exec }),
  };

  // Agent definitions hold no secrets (keys stay in env), so the admin screen gets them whole.
  app.get('/agents', async () => listAgents(opts.dataDir));

  async function save(id: string, body: Partial<Agent>, reply: FastifyReply, code: number) {
    const agent = withDefaults(body, id);
    const error = checkAgent(agent, {
      connections: (await loadConnections(opts.dataDir)).map((c) => c.id),
      tools: [...listTools().map((t) => t.name), ...agent.tools.filter(mcp.isRegistered)],
    });
    if (error) return reply.code(400).send({ error });
    await saveAgent(opts.dataDir, agent);
    // build the image with its extra packages in the background, then drop package images nobody uses any more
    void (opts.prepareEnv ?? (async (x: Agent) => { await prepareEnv(x); await pruneEnvImages(await listAgents(opts.dataDir)); }))(agent).catch((e) => app.log.error(e));
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

  app.delete('/agents/:id', { schema: { params: agentParams, querystring: { type: 'object', properties: { files: { type: 'boolean' } } } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!agentExists(opts.dataDir, id)) return reply.code(404).send({ error: 'agent not found' });
    const user = (await listTeams(opts.dataDir)).find((t) => t.main === id || t.members.includes(id));
    if (user) return reply.code(409).send({ error: `used by team ${user.id}` });
    await deleteAgent(opts.dataDir, id);
    await removeSandbox(id, (req.query as { files?: boolean }).files === true).catch(() => {}); // files stay unless asked
    return reply.code(204).send();
  });

  /** The agent's sandbox environment: which image it runs and how building it with the extra packages went. */
  app.get('/agents/:id/env', { schema: { params: agentParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!agentExists(opts.dataDir, id)) return reply.code(404).send({ error: 'agent not found' });
    return envState(await loadAgent(opts.dataDir, id));
  });

  /** The agent with its teams (they decide the sandbox mounts), or null. */
  const withTeams = async (id: string) => agentExists(opts.dataDir, id) ? (await resolve(opts.dataDir, `agent:${id}`)).agents.get(id)! : null;
  /** A missing file is 404; anything else means the sandbox could not be reached (Docker off, image missing). */
  const fileError = (reply: FastifyReply, e: unknown) => reply.code(e instanceof NotFound ? 404 : 503).send({ error: (e as Error).message });
  /**
   * Whose folder a files URL means: an agent's /work, or a team's /team/<id> reached through its main's sandbox
   * (the team volume is mounted in every member's sandbox, so no team container is needed).
   */
  const owners = {
    agents: async (id: string) => { const agent = await withTeams(id); return agent && { agent, root: '/work', zip: `${id}-work.zip` }; },
    teams: async (id: string) => {
      const team = teamExists(opts.dataDir, id) ? (await listTeams(opts.dataDir)).find((t) => t.id === id) : undefined;
      const agent = team && await withTeams(team.main);
      return agent && { agent, root: `/team/${id}`, zip: `${id}-team.zip` };
    },
  };
  for (const [kind, owner] of Object.entries(owners)) {
    const missing = { error: `${kind === 'agents' ? 'agent' : 'team'} not found` };
    app.get(`/${kind}/:id/files`, { schema: { params: agentParams } }, async (req, reply) => {
      const o = await owner((req.params as { id: string }).id);
      if (!o) return reply.code(404).send(missing);
      try {
        return (await files.list(o.agent, o.root)).map((f) => f.slice(o.root.length + 1));
      } catch (e) {
        return fileError(reply, e);
      }
    });

    app.get(`/${kind}/:id/files/*`, { schema: { params: agentParams, querystring: { type: 'object', properties: { download: { type: 'boolean' } } } } }, async (req, reply) => {
      const { id, '*': rel } = req.params as { id: string; '*': string };
      const o = await owner(id);
      if (!o) return reply.code(404).send(missing);
      let file: string;
      try {
        file = containerPath(o.agent, `${o.root}/${rel}`);
        if (!file.startsWith(`${o.root}/`)) throw new Error(`path outside the folder: ${rel}`);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      try {
        const body = await files.read(o.agent, file);
        if (!(req.query as { download?: boolean }).download) return reply.type('text/plain; charset=utf-8').send(body);
        return reply.type('application/octet-stream')
          .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.posix.basename(file))}`).send(body);
      } catch (e) {
        return fileError(reply, e);
      }
    });

    app.get(`/${kind}/:id/zip`, { schema: { params: agentParams } }, async (req, reply) => {
      const o = await owner((req.params as { id: string }).id);
      if (!o) return reply.code(404).send(missing);
      try {
        const body = await files.zip(o.agent, o.root);
        return reply.type('application/zip').header('content-disposition', `attachment; filename="${o.zip}"`).send(body);
      } catch (e) {
        return fileError(reply, e);
      }
    });
  }

  app.get('/teams', async () => listTeams(opts.dataDir));

  async function saveT(id: string, body: Partial<Team>, reply: FastifyReply, code: number) {
    const teams = await listTeams(opts.dataDir);
    const team = teamWithDefaults({ ...body, room: null }, id);
    const error = checkTeam(team, new Set((await listAgents(opts.dataDir)).map((a) => a.id)), new Map(teams.map((t) => [t.id, t])));
    if (error) return reply.code(400).send({ error });
    // keep notes only for people in the team, and drop empty ones
    team.roles = Object.fromEntries(Object.entries(team.roles).filter(([id, r]) => (id === team.main || team.members.includes(id)) && (r.role?.trim() || r.instructions?.trim()))
      .map(([id, r]) => [id, { role: r.role?.trim() ?? '', instructions: r.instructions?.trim() ?? '' }]));
    team.room = assignRoom(team, teams);
    team.color = assignColor(team, teams);
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

  // ponytail: model lists cached 10 minutes per connection; add a refresh button if gateways change often
  const modelCache = new Map<string, { at: number; ids: string[] }>();
  app.get('/models/:id/available', { schema: { params: idParams } }, async (req, reply) => {
    const c = (await loadConnections(opts.dataDir)).find((x) => x.id === (req.params as { id: string }).id);
    if (!c) return reply.code(404).send({ error: 'connection not found' });
    const hit = modelCache.get(c.id);
    if (hit && Date.now() - hit.at < 600_000) return hit.ids;
    const key = process.env[c.apiKeyEnv];
    try {
      const res = await fetch(`${c.baseURL.replace(/\/$/, '')}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // chat models only: BAZE also lists image/video models (type) and some without a chat endpoint; vLLM sends neither field
      const ids = ((await res.json()).data as { id: string; type?: string; endpoints?: string[]; shutdown_at?: string | null }[])
        .filter((m) => (!m.type || m.type === 'llm') && (!m.endpoints || m.endpoints.some((e) => e.includes('chat/completions'))) && !m.shutdown_at)
        .map((m) => m.id).sort();
      modelCache.set(c.id, { at: Date.now(), ids });
      return ids;
    } catch (e) {
      return reply.code(502).send({ error: `could not list models: ${(e as Error).message}` }); // never echo the key
    }
  });

  app.get('/tools', async () => [
    ...listTools().map((t) => ({ ...t, server: null })),
    ...mcp.list().flatMap((s) => s.tools.map((t) => ({ ...t, server: s.name }))),
  ]);

  app.get('/mcp', async () => mcp.list());

  /** Add one server ({ name, url } / { name, command, ... }) or paste a whole { mcpServers: {...} } block. */
  app.post('/mcp', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const entries = body.mcpServers && typeof body.mcpServers === 'object'
      ? Object.entries(body.mcpServers as Record<string, unknown>)
      : [[String(body.name ?? ''), body] as [string, unknown]];
    if (!entries.length) return reply.code(400).send({ error: 'no servers given' });
    const parsed: (readonly [string, McpConfig])[] = [];
    for (const [name, raw] of entries) {
      if (!MCP_NAME.test(name)) return reply.code(400).send({ error: `invalid server name "${name}": lowercase letters, digits and -` });
      if (mcp.has(name)) return reply.code(409).send({ error: `server ${name} already exists` });
      const config = parseConfig(raw);
      if (typeof config === 'string') return reply.code(400).send({ error: `${name}: ${config}` });
      parsed.push([name, config] as const);
    }
    await Promise.all(parsed.map(([name, config]) => mcp.add(name, config)));
    return reply.code(201).send(mcp.list().filter((s) => parsed.some(([n]) => n === s.name)));
  });

  const mcpParams = { type: 'object', required: ['name'], properties: { name: { type: 'string', pattern: MCP_NAME.source } } };

  app.delete('/mcp/:name', { schema: { params: mcpParams } }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!mcp.has(name)) return reply.code(404).send({ error: 'server not found' });
    await mcp.remove(name);
    return reply.code(204).send();
  });

  app.post('/mcp/:name/reconnect', { schema: { params: mcpParams } }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!mcp.has(name)) return reply.code(404).send({ error: 'server not found' });
    await mcp.connect(name);
    return mcp.list().find((s) => s.name === name);
  });

  app.post('/agui', {
    schema: {
      body: {
        type: 'object',
        required: ['threadId', 'runId', 'messages', 'forwardedProps'],
        properties: {
          threadId: { type: 'string', pattern: ID },
          runId: { type: 'string', pattern: ID },
          messages: { type: 'array', maxItems: 500, items: { type: 'object', required: ['role'], properties: { role: { enum: ['user', 'assistant', 'system', 'developer', 'tool'] } } } },
          forwardedProps: { type: 'object', required: ['target'], properties: {
            target: { type: 'string', pattern: TARGET },
            model: { type: 'string', pattern: '^[A-Za-z0-9._:/@-]{1,100}$' }, // this run only, for every agent taking part
          } },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { threadId: string; runId: string; messages: AgUiMessage[]; forwardedProps: { target: string; model?: string } };
    if (bus.exists(body.runId)) return reply.code(409).send({ error: 'runId already used' });
    const { target, model } = body.forwardedProps;
    const defs = await resolve(opts.dataDir, target).catch(() => null);
    if (!defs) return reply.code(404).send({ error: `${target} not found, or one of its members is missing` });
    if (model) for (const [id, a] of defs.agents) defs.agents.set(id, { ...a, model });
    const team = target.startsWith('team:') ? defs.teams.get(target.slice('team:'.length)) : undefined;

    // The thread is the session: remember its user message now and the outcome when the run ends.
    const db = opts.db;
    if (db) {
      const first = body.messages.find((m) => m.role === 'user');
      const session = await db.touch(body.threadId, target, typeof first?.content === 'string' ? first.content : '');
      if (session.target !== target) return reply.code(409).send({ error: `session ${body.threadId} belongs to ${session.target}` });
      const last = body.messages.at(-1);
      if (last?.role === 'user') await db.add(body.threadId, { runId: body.runId, role: 'user', content: typeof last.content === 'string' ? last.content : JSON.stringify(last.content), model: model ?? null });
    }

    const ac = new AbortController();
    running.set(body.runId, ac);
    const write = sse(reply);
    // close the stream only after the outcome is saved, so a client reloading the session right away sees it
    let saved: Promise<unknown> = Promise.resolve();
    const off = bus.follow(body.runId, -1, (seq, e) => write(String(seq), e), () => void saved.then(() => reply.raw.end()));
    reply.raw.on('close', off); // the run keeps going if the client disconnects
    const timeout = AbortSignal.timeout(team ? team.limits.timeoutSec * 1000 : RUN_TIMEOUT_MS);
    saved = startRun({ ...body, target, defs }, deps, (e) => bus.emit(body.runId, e), AbortSignal.any([ac.signal, timeout]))
      .then(async () => {
        if (!db) return;
        const evs = bus.history(body.runId);
        const steps = summarizeRun(evs);
        const end = evs.at(-1);
        const mainAgent = defs.agents.get(team ? team.main : target.slice('agent:'.length));
        const usedModel = model || mainAgent?.model
          || (await loadConnections(opts.dataDir)).find((c) => c.id === mainAgent?.connection)?.defaultModel || null;
        if (steps.length) await db.add(body.threadId, { runId: body.runId, role: 'activity', content: JSON.stringify(steps), model: null });
        const usage = sumUsage(evs);
        if (usage) await db.add(body.threadId, { runId: body.runId, role: 'usage', content: JSON.stringify(usage), model: null });
        if (end?.type === 'RUN_FINISHED') await db.add(body.threadId, { runId: body.runId, role: 'assistant', content: String(end.result ?? ''), model: usedModel || null });
        else if (end) await db.add(body.threadId, { runId: body.runId, role: 'error', content: String(end.message ?? 'error'), model: null });
      })
      .catch((e) => app.log.error(e))
      .finally(() => running.delete(body.runId));
  });

  const noDb = (reply: FastifyReply) => reply.code(503).send({ error: 'sessions need the database (npm run db)' });

  app.get('/sessions', { schema: { querystring: { type: 'object', properties: { target: { type: 'string', pattern: TARGET } } } } }, async (req, reply) =>
    opts.db ? opts.db.list((req.query as { target?: string }).target) : noDb(reply));

  app.get('/sessions/:id', { schema: { params: idParams } }, async (req, reply) => {
    if (!opts.db) return noDb(reply);
    return (await opts.db.get((req.params as { id: string }).id)) ?? reply.code(404).send({ error: 'session not found' });
  });

  app.delete('/sessions/:id', { schema: { params: idParams } }, async (req, reply) => {
    if (!opts.db) return noDb(reply);
    return (await opts.db.remove((req.params as { id: string }).id)) ? reply.code(204).send() : reply.code(404).send({ error: 'session not found' });
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
