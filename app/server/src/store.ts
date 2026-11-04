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
};

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

function agentFile(dataDir: string, id: string): string {
  if (!AGENT_ID.test(id)) throw new Error(`invalid agent id: ${id}`);
  return path.join(dataDir, 'agents', `${id}.json`);
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

export async function saveAgent(dataDir: string, agent: Agent): Promise<void> {
  const { id, ...def } = agent; // the file name is the id
  const file = agentFile(dataDir, id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(def, null, 2) + '\n');
}

export const deleteAgent = (dataDir: string, id: string) => unlink(agentFile(dataDir, id));

export async function listAgents(dataDir: string): Promise<Agent[]> {
  const dir = path.join(dataDir, 'agents');
  if (!existsSync(dir)) return [];
  const ids = (await readdir(dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter((id) => AGENT_ID.test(id))
    .sort();
  return Promise.all(ids.map((id) => loadAgent(dataDir, id)));
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
      },
      { signal },
    );
  };
}
