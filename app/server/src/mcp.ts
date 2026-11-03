import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { removeContainer } from './sandbox.ts';
import type { ToolDef } from './store.ts';

/** One entry of the `mcpServers` format (Claude Desktop / Cursor), plus our `network` switch for stdio servers. */
export type McpConfig = { url: string } | { command: string; args?: string[]; env?: Record<string, string>; network?: boolean };
export type McpStatus = 'connecting' | 'connected' | 'failed' | 'auth';
type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
type Entry = { config: McpConfig; client?: Client; status: McpStatus; error?: string; tools: McpTool[] };

export const MCP_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/; // part of tool and container names
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/; // OpenAI function-name rule
const SANDBOX_IMAGE = 'agentview/sandbox:base';
const mcpContainer = (name: string) => `mcp-${name}`; // removeContainer() prefixes "agentview-"

/** Validate one pasted or typed server entry. Returns the config, or an error message. */
export function parseConfig(raw: unknown): McpConfig | string {
  const c = raw as Record<string, unknown> | null;
  if (!c || typeof c !== 'object') return 'server config must be an object';
  if (typeof c.url === 'string') return /^https?:\/\//.test(c.url) ? { url: c.url } : 'url must start with http:// or https://';
  if (typeof c.command !== 'string' || !c.command || c.command.length > 200) return 'needs a url or a command';
  const args = c.args ?? [];
  if (!Array.isArray(args) || args.length > 50 || args.some((a) => typeof a !== 'string')) return 'args must be a list of strings';
  const env = c.env ?? {};
  if (typeof env !== 'object' || Object.entries(env).some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string')) return 'env must map names to strings';
  return { command: c.command, args: args as string[], env: env as Record<string, string>, network: c.network === true };
}

/** URL servers connect from this process; stdio servers run in their own throwaway sandbox container. */
export function defaultTransport(name: string, c: McpConfig): Transport {
  if ('url' in c) return new StreamableHTTPClientTransport(new URL(c.url));
  return new StdioClientTransport({
    command: 'docker',
    args: [
      'run', '-i', '--rm', '--name', `agentview-${mcpContainer(name)}`,
      ...(c.network ? [] : ['--network', 'none']), '--memory', '512m', '--cpus', '1',
      ...Object.entries(c.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      SANDBOX_IMAGE, c.command, ...(c.args ?? []), // everything after the image is the command, never docker flags
    ],
    stderr: 'ignore',
  });
}

const mask = (c: McpConfig): McpConfig =>
  'env' in c && c.env ? { ...c, env: Object.fromEntries(Object.keys(c.env).map((k) => [k, '***'])) } : c;

export type Mcp = ReturnType<typeof createMcp>;

export function createMcp(dataDir: string, opts: { transport?: typeof defaultTransport; cleanup?: (name: string) => Promise<void> } = {}) {
  const transport = opts.transport ?? defaultTransport;
  const cleanup = opts.cleanup ?? ((name: string) => removeContainer(mcpContainer(name)));
  const file = path.join(dataDir, 'mcp.json');
  const servers = new Map<string, Entry>();
  const toolName = (server: string, tool: string) => `mcp__${server}__${tool}`;

  const save = () =>
    writeFile(file, JSON.stringify({ mcpServers: Object.fromEntries([...servers].map(([n, e]) => [n, e.config])) }, null, 2) + '\n');

  /** (Re)connect and fetch the tool list. Never throws: the outcome is the entry's status. */
  async function connect(name: string): Promise<void> {
    const e = servers.get(name);
    if (!e) return;
    await e.client?.close().catch(() => {});
    Object.assign(e, { client: undefined, status: 'connecting', error: undefined });
    if (!('url' in e.config)) await cleanup(name).catch(() => {}); // a container left by a crashed server would block the name
    const client = new Client({ name: 'agentview', version: '0.1.0' });
    try {
      await client.connect(transport(name, e.config));
      // ponytail: first page of tools only; follow nextCursor if a server ever lists more
      const { tools } = await client.listTools();
      if (servers.get(name) !== e) return void (await client.close()); // removed while connecting
      Object.assign(e, { client, status: 'connected', tools });
    } catch (err) {
      await client.close().catch(() => {});
      Object.assign(e, { status: err instanceof UnauthorizedError ? 'auth' : 'failed', error: (err as Error).message, tools: [] });
    }
  }

  async function add(name: string, config: McpConfig): Promise<void> {
    servers.set(name, { config, status: 'connecting', tools: [] });
    await save();
    await connect(name);
  }

  async function remove(name: string): Promise<void> {
    const e = servers.get(name);
    servers.delete(name);
    await save();
    await e?.client?.close().catch(() => {});
    if (e && !('url' in e.config)) await cleanup(name).catch(() => {});
  }

  async function load(): Promise<void> {
    if (!existsSync(file)) return;
    const { mcpServers = {} } = JSON.parse(await readFile(file, 'utf8')) as { mcpServers?: Record<string, unknown> };
    await Promise.all(Object.entries(mcpServers).map(([name, raw]) => {
      const config = parseConfig(raw);
      if (!MCP_NAME.test(name) || typeof config === 'string') return;
      servers.set(name, { config, status: 'connecting', tools: [] });
      return connect(name);
    }));
  }

  const list = () => [...servers].map(([name, e]) => ({
    name, config: mask(e.config), status: e.status, error: e.error,
    tools: e.tools.map((t) => ({ name: toolName(name, t.name), description: t.description ?? '' })),
  }));

  /** Definitions for the MCP tools in `allowed`: being connected does not open a tool to every agent. */
  function defs(allowed: string[]): ToolDef[] {
    const out: ToolDef[] = [];
    for (const [server, e] of servers) {
      for (const t of e.tools) {
        const name = toolName(server, t.name);
        if (allowed.includes(name) && TOOL_NAME.test(name)) {
          out.push({ type: 'function', function: { name, description: (t.description ?? '').slice(0, 1000), parameters: t.inputSchema } });
        }
      }
    }
    return out;
  }

  /** An allowed tool may be saved while its server is down; it must at least belong to a registered server. */
  const isRegistered = (tool: string) => [...servers.keys()].some((s) => tool.startsWith(`mcp__${s}__`));

  async function call(name: string, rawArgs: string, signal: AbortSignal): Promise<string> {
    const server = [...servers.keys()].find((s) => name.startsWith(`mcp__${s}__`));
    const e = server ? servers.get(server) : undefined;
    if (!server || !e) throw new Error(`no MCP server for tool ${name}`);
    if (e.status !== 'connected') await connect(server); // a dropped connection is retried on the next call
    if (!e.client) throw new Error(`MCP server ${server} is not connected: ${e.error ?? e.status}`);
    try {
      const res = await e.client.callTool({ name: name.slice(`mcp__${server}__`.length), arguments: JSON.parse(rawArgs || '{}') }, undefined, { signal, timeout: 120_000 });
      const text = ((res.content ?? []) as { type: string; text?: string }[])
        .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
      return res.isError ? `ERROR: ${text}` : text;
    } catch (err) {
      if (!signal.aborted) Object.assign(e, { status: 'failed', error: (err as Error).message });
      throw err;
    }
  }

  const closeAll = () => Promise.all([...servers].map(async ([name, e]) => {
    await e.client?.close().catch(() => {});
    if (!('url' in e.config)) await cleanup(name).catch(() => {});
  }));

  return { load, add, remove, connect, list, defs, isRegistered, call, closeAll, has: (name: string) => servers.has(name) };
}
