import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

export type Agent = {
  id: string;
  name: string;
  role: string;
  connection: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  sandbox: { image: string; network: boolean };
  avatar: { model: string; color: string };
  maxSteps: number;
  /** Run-time only, never saved: teams the agent belongs to (shared folders are mounted from these). */
  teams?: string[];
};

export type Pattern = 'supervisor' | 'parallel' | 'debate';
export type Team = {
  id: string;
  name: string;
  pattern: Pattern;
  main: string;
  /** Agent ids, or `team:<id>` for a nested team. */
  members: string[];
  limits: { maxDepth: number; maxCalls: number; timeoutSec: number; rounds: number };
  /** Order of the team's room in the office (1, 2, …), assigned by the server; rooms are sized by the web from the members. */
  room: number | null;
  /** Team color (#rrggbb) for its room, label and members; picked by the server when not given. */
  color: string;
  /** Per person in this team only: a role that replaces the agent's own, and instructions added to its own. Empty = the agent's defaults. */
  roles: Record<string, { role: string; instructions: string }>;
};
/** Team colors that do not look like a status color (green, orange, yellow, blue, red). */
export const TEAM_COLORS = ['#8a5cd6', '#1aa3a3', '#d6589c', '#3f51b5', '#9c6b3f', '#7a8f2a', '#5d6d7e', '#6d4c8f'];

export type Connection = { id: string; baseURL: string; apiKeyEnv: string; defaultModel?: string; maxTokens?: number };

export const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

const DEFAULTS = {
  role: '',
  model: '',
  systemPrompt: '',
  tools: [],
  maxSteps: 6,
  sandbox: { image: 'agentview/sandbox:base', network: false },
  avatar: { model: 'default.glb', color: '#5b8def' },
};

export const withDefaults = (raw: Partial<Agent>, id: string): Agent => ({ ...DEFAULTS, name: id, ...raw, id }) as Agent;

type Kind = 'agents' | 'teams';
function defFile(dataDir: string, kind: Kind, id: string): string {
  if (!AGENT_ID.test(id)) throw new Error(`invalid ${kind.slice(0, -1)} id: ${id}`);
  return path.join(dataDir, kind, `${id}.json`);
}
const agentFile = (dataDir: string, id: string) => defFile(dataDir, 'agents', id);

async function listIds(dataDir: string, kind: Kind): Promise<string[]> {
  const dir = path.join(dataDir, kind);
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter((id) => AGENT_ID.test(id))
    .sort();
}

async function writeDef(dataDir: string, kind: Kind, def: { id: string }): Promise<void> {
  const { id, ...rest } = def; // the file name is the id
  const file = defFile(dataDir, kind, id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(rest, null, 2) + '\n');
}

export const agentExists = (dataDir: string, id: string) => existsSync(agentFile(dataDir, id));

export async function loadAgent(dataDir: string, id: string): Promise<Agent> {
  return withDefaults(JSON.parse(await readFile(agentFile(dataDir, id), 'utf8')), id);
}

/** Reference checks the request schema cannot express. Returns an error message, or null when valid. */
export function checkAgent(a: Agent, known: { connections: string[]; tools: string[] }): string | null {
  if (!known.connections.includes(a.connection)) return `unknown model connection: ${a.connection}`;
  const bad = a.tools.find((t) => !known.tools.includes(t));
  return bad ? `unknown tool: ${bad}` : null;
}

export const saveAgent = (dataDir: string, { teams: _runtimeOnly, ...agent }: Agent) => writeDef(dataDir, 'agents', agent);
export const deleteAgent = (dataDir: string, id: string) => unlink(agentFile(dataDir, id));
export const listAgents = async (dataDir: string) => Promise.all((await listIds(dataDir, 'agents')).map((id) => loadAgent(dataDir, id)));

const TEAM_LIMITS = { maxDepth: 3, maxCalls: 50, timeoutSec: 600, rounds: 2 };

export const teamWithDefaults = (raw: Partial<Team>, id: string): Team =>
  ({ name: id, members: [], room: null, color: '', roles: {}, ...raw, limits: { ...TEAM_LIMITS, ...raw.limits }, id }) as Team;

export const teamExists = (dataDir: string, id: string) => existsSync(defFile(dataDir, 'teams', id));
export const loadTeam = async (dataDir: string, id: string) =>
  teamWithDefaults(JSON.parse(await readFile(defFile(dataDir, 'teams', id), 'utf8')), id);
export async function listTeams(dataDir: string) {
  const teams = await Promise.all((await listIds(dataDir, 'teams')).map((id) => loadTeam(dataDir, id)));
  for (const t of teams) if (!t.color) t.color = assignColor(t, teams); // teams saved before colors existed
  return teams;
}
export const saveTeam = (dataDir: string, team: Team) => writeDef(dataDir, 'teams', team);
export const deleteTeam = (dataDir: string, id: string) => unlink(defFile(dataDir, 'teams', id));

const nested = (member: string) => (member.startsWith('team:') ? member.slice('team:'.length) : null);

/** Checks the request schema cannot express: references exist, main is not a member, nesting has no cycle. */
export function checkTeam(t: Team, agents: Set<string>, teams: Map<string, Team>): string | null {
  if (!agents.has(t.main)) return `unknown main agent: ${t.main}`;
  if (t.members.includes(t.main)) return 'the main agent cannot also be a member';
  const bad = t.members.find((m) => { const n = nested(m); return n ? !teams.has(n) && n !== t.id : !agents.has(m); });
  if (bad) return `unknown member: ${bad}`;
  const seen = new Set<string>();
  const reaches = (id: string): boolean => {
    if (id === t.id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (teams.get(id)?.members ?? []).some((m) => { const n = nested(m); return n !== null && reaches(n); });
  };
  return t.members.some((m) => { const n = nested(m); return n !== null && reaches(n); }) ? 'team nesting would form a cycle' : null;
}

/** Keep the team's room number, else take the lowest free one. There is no limit: the office widens. */
export function assignRoom(t: Team, others: Team[]): number {
  const own = others.find((o) => o.id === t.id)?.room;
  if (own) return own;
  const used = new Set(others.filter((o) => o.id !== t.id).map((o) => o.room));
  let r = 1;
  while (used.has(r)) r++;
  return r;
}

/** The color given, else the team's previous one, else the first color no other team uses. */
export function assignColor(t: Team, others: Team[]): string {
  if (t.color) return t.color;
  const own = others.find((o) => o.id === t.id)?.color;
  if (own) return own;
  const used = new Set(others.map((o) => o.color));
  return TEAM_COLORS.find((c) => !used.has(c)) ?? TEAM_COLORS[others.length % TEAM_COLORS.length];
}

export const teamsOf = (agentId: string, teams: Team[]) => teams.filter((t) => t.main === agentId || t.members.includes(agentId)).map((t) => t.id);

export type Defs = { agents: Map<string, Agent>; teams: Map<string, Team> };

/** Snapshot every definition a run needs (target plus nested members), so edits mid-run apply to the next run. */
export async function resolve(dataDir: string, target: string): Promise<Defs> {
  const all = await listTeams(dataDir);
  const defs: Defs = { agents: new Map(), teams: new Map() };
  const visit = async (name: string): Promise<void> => {
    const n = nested(name);
    if (n === null) {
      if (!defs.agents.has(name)) defs.agents.set(name, { ...(await loadAgent(dataDir, name)), teams: teamsOf(name, all) });
      return;
    }
    if (defs.teams.has(n)) return;
    const team = await loadTeam(dataDir, n);
    defs.teams.set(n, team);
    await visit(team.main);
    for (const m of team.members) await visit(m);
  };
  await visit(target.startsWith('agent:') ? target.slice('agent:'.length) : target);
  return defs;
}

export async function loadConnections(dataDir: string): Promise<Connection[]> {
  const f = path.join(dataDir, 'models.json');
  return existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : [];
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};
export type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type ChatRequest = { connection: string; model: string; messages: ChatMessage[]; tools: ToolDef[] };
export type ChatChunk = {
  choices: {
    delta?: {
      content?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  /** tokens of the whole reply, on the last chunk (requested with stream_options.include_usage) */
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
};
export type ChatFn = (req: ChatRequest, signal: AbortSignal) => Promise<AsyncIterable<ChatChunk>>;

type CreateParams = Parameters<OpenAI['chat']['completions']['create']>[0];

/** OpenAI-compatible streaming chat. BAZE, DGX (vLLM) and proxies differ only by baseURL. */
export function openaiChat(connections: Connection[]): ChatFn {
  const clients = new Map<string, OpenAI>();
  return async (req, signal) => {
    const c = connections.find((x) => x.id === req.connection);
    if (!c) throw new Error(`unknown model connection: ${req.connection}`);
    const apiKey = process.env[c.apiKeyEnv];
    if (!apiKey) throw new Error(`environment variable ${c.apiKeyEnv} is not set`);
    let client = clients.get(c.id);
    if (!client) clients.set(c.id, (client = new OpenAI({ baseURL: c.baseURL, apiKey })));
    return client.chat.completions.create(
      {
        model: req.model || c.defaultModel || '',
        messages: req.messages as CreateParams['messages'],
        tools: req.tools.length ? (req.tools as CreateParams['tools']) : undefined,
        max_tokens: c.maxTokens ?? 1024, // token budget per model reply
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal },
    );
  };
}
