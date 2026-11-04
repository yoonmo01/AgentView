import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createMcp, parseConfig } from '../src/mcp.ts';

/** A real MCP server with one `echo` tool, connected in memory. */
export function memoryTransport() {
  const server = new Server({ name: 'demo', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({ content: [{ type: 'text', text: `echo: ${String(req.params.arguments?.text)}` }] }));
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  void server.connect(serverSide);
  return client;
}
const noCleanup = async () => {};
const sig = () => new AbortController().signal;
const dir = () => mkdtempSync(path.join(tmpdir(), 'av-mcp-'));

describe('mcp', () => {
  it('connects, exposes only allowed tools, calls them and forgets removed servers', async () => {
    const d = dir();
    const mcp = createMcp(d, { transport: memoryTransport, cleanup: noCleanup });
    await mcp.add('demo', { url: 'http://unused' });
    expect(mcp.list()).toMatchObject([{ name: 'demo', status: 'connected', tools: [{ name: 'mcp__demo__echo', description: 'Echo the text back' }] }]);
    expect(mcp.defs([])).toEqual([]);
    expect(mcp.defs(['mcp__demo__echo'])[0].function).toMatchObject({ name: 'mcp__demo__echo', parameters: { properties: { text: { type: 'string' } } } });
    expect(await mcp.call('mcp__demo__echo', '{"text":"hi"}', sig())).toBe('echo: hi');
    expect(mcp.isRegistered('mcp__demo__anything')).toBe(true);
    expect(JSON.parse(readFileSync(path.join(d, 'mcp.json'), 'utf8'))).toEqual({ mcpServers: { demo: { url: 'http://unused' } } });
    await mcp.remove('demo');
    expect(mcp.list()).toEqual([]);
    expect(mcp.isRegistered('mcp__demo__echo')).toBe(false);
  });

  it('records a failed connection, then reconnects on load', async () => {
    const d = dir();
    let up = false;
    const flaky = () => { if (!up) throw new Error('connection refused'); return memoryTransport(); };
    const mcp = createMcp(d, { transport: flaky, cleanup: noCleanup });
    await mcp.add('demo', { command: 'x', env: { TOKEN: 'secret' } });
    expect(mcp.list()[0]).toMatchObject({ status: 'failed', error: 'connection refused', config: { env: { TOKEN: '***' } } });
    up = true;
    const again = createMcp(d, { transport: flaky, cleanup: noCleanup });
    await again.load();
    expect(again.list()[0]).toMatchObject({ status: 'connected' });
    expect(existsSync(path.join(d, 'mcp.json'))).toBe(true);
  });

  it('validates pasted server configs', () => {
    expect(parseConfig({ url: 'https://x/mcp' })).toEqual({ url: 'https://x/mcp' });
    expect(parseConfig({ url: 'file:///etc' })).toMatch('http');
    expect(parseConfig({ command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } })).toEqual({ command: 'npx', args: ['-y', 'pkg'], env: { A: '1' }, network: false });
    expect(parseConfig({ command: 'npx', args: [1] })).toMatch('args');
    expect(parseConfig({ command: 'npx', env: { 'bad key': 'x' } })).toMatch('env');
    expect(parseConfig({})).toMatch('url or a command');
  });
});
