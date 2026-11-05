import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.ts';
import { createMcp, type Mcp } from '../src/mcp.ts';
import type { ChatFn } from '../src/store.ts';
import { memoryTransport } from './mcp.test.ts';
import { memFiles } from './memFiles.ts';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

const hello: ChatFn = async () => (async function* () { yield { choices: [{ delta: { content: 'hello' } }] }; })();

let dataDir = '';
let files = memFiles();
let removed: [string, boolean][] = [];
async function start(chat: ChatFn = hello, mcp?: Mcp) {
  dataDir = mkdtempSync(path.join(tmpdir(), 'av-app-'));
  files = memFiles();
  removed = [];
  mkdirSync(path.join(dataDir, 'agents'));
  writeFileSync(path.join(dataDir, 'agents', 'nova.json'), JSON.stringify({ name: 'Nova', connection: 'c', model: 'm' }));
  writeFileSync(path.join(dataDir, 'models.json'), JSON.stringify([{ id: 'c', baseURL: 'http://x', apiKeyEnv: 'NOPE', defaultModel: 'm' }]));
  const app = buildApp({
    dataDir, chat, files, exec: async () => { throw new Error('no docker in this test'); }, removeSandbox: async (id, withFiles) => { removed.push([id, withFiles]); },
    mcp: mcp ?? createMcp(dataDir, { cleanup: async () => {} }),
  });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

const body = (runId: string, target = 'agent:nova') => ({
  threadId: 't1', runId, tools: [], context: [], forwardedProps: { target },
  messages: [{ id: 'm1', role: 'user', content: 'hi' }],
});
const post = (url: string, payload: unknown) =>
  fetch(`${url}/agui`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
const sseEvents = (text: string) =>
  text.split('\n\n').filter((b) => b.includes('data: ')).map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));

describe('http api', () => {
  it('streams a run over SSE and replays it afterwards', async () => {
    const url = await start();
    const res = await post(url, body('run1'));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const types = sseEvents(await res.text()).map((e) => e.type);
    expect(types).toEqual(['RUN_STARTED', 'CUSTOM', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);

    const replay = await fetch(`${url}/runs/run1/events`);
    expect(sseEvents(await replay.text())).toHaveLength(6);
    const resumed = await fetch(`${url}/runs/run1/events`, { headers: { 'last-event-id': '3' } });
    expect(sseEvents(await resumed.text()).map((e) => e.type)).toEqual(['TEXT_MESSAGE_END', 'RUN_FINISHED']);
    expect(await (await fetch(`${url}/runs`)).json()).toMatchObject([{ runId: 'run1', live: false, target: 'agent:nova', agents: ['nova'] }]);
  });

  it('rejects unsafe targets and run ids', async () => {
    const url = await start();
    expect((await post(url, body('run2', 'agent:../x'))).status).toBe(400);
    expect((await post(url, body('../run'))).status).toBe(400);
    expect((await fetch(`${url}/runs/..%2Fx/events`)).status).toBe(400);
  });

  it('returns 404 for unknown agents and runs, 409 for a reused run id', async () => {
    const url = await start();
    expect((await post(url, body('run3', 'agent:ghost'))).status).toBe(404);
    expect((await fetch(`${url}/runs/nope/events`)).status).toBe(404);
    await (await post(url, body('run4'))).text();
    expect((await post(url, body('run4'))).status).toBe(409);
  });

  it('cancels a running run', async () => {
    const hang: ChatFn = (_req, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const url = await start(hang);
    const res = await post(url, body('run5'));
    expect((await fetch(`${url}/runs/run5/cancel`, { method: 'POST' })).status).toBe(202);
    expect(sseEvents(await res.text()).at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'cancelled' });
    expect((await fetch(`${url}/runs/run5/cancel`, { method: 'POST' })).status).toBe(404);
  });

  it('creates, updates and deletes agents with reference checks', async () => {
    const url = await start();
    const send = (method: string, p: string, payload?: unknown) => fetch(`${url}${p}`, {
      method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined,
    });
    const milo = { id: 'milo', name: 'Milo', connection: 'c', tools: ['sandbox_run'] };
    const created = await send('POST', '/agents', milo);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: 'milo', maxSteps: 6, sandbox: { network: false } });
    expect((await send('POST', '/agents', milo)).status).toBe(409);
    expect((await send('POST', '/agents', { ...milo, id: 'x1', connection: 'ghost' })).status).toBe(400);
    expect((await send('POST', '/agents', { ...milo, id: 'x2', tools: ['rm_rf'] })).status).toBe(400);
    expect((await send('POST', '/agents', { ...milo, id: 'x3', sandbox: { image: '--privileged', network: false } })).status).toBe(400);

    expect((await send('PUT', '/agents/milo', { ...milo, name: 'Milo 2', maxSteps: 3 })).status).toBe(200);
    expect((await (await fetch(`${url}/agents`)).json()).map((a: { name: string }) => a.name)).toEqual(['Milo 2', 'Nova']);
    expect((await send('DELETE', '/agents/milo?files=true')).status).toBe(204);
    expect(removed).toEqual([['milo', true]]);
    expect((await send('PUT', '/agents/milo', milo)).status).toBe(404);
  });

  it('saves teams with a server-assigned room and protects referenced definitions', async () => {
    const url = await start();
    const send = (method: string, p: string, payload?: unknown) => fetch(`${url}${p}`, {
      method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined,
    });
    await send('POST', '/agents', { id: 'atlas', name: 'Atlas', connection: 'c' });
    const dev = { id: 'dev', name: '개발팀', pattern: 'supervisor', main: 'atlas', members: ['nova'], room: 4 };
    const created = await send('POST', '/teams', dev);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ room: 1, limits: { maxCalls: 50, rounds: 2 } }); // client room ignored
    const roles = { nova: { role: ' 백엔드 ', instructions: '' }, atlas: { role: '', instructions: '' }, ghost: { role: 'x', instructions: '' } };
    const withRoles = await (await send('PUT', '/teams/dev', { ...dev, roles })).json();
    expect(withRoles.roles).toEqual({ nova: { role: '백엔드', instructions: '' } }); // trimmed; empty and non-member notes dropped
    expect((await send('POST', '/teams', { ...dev, id: 'bad', members: ['atlas'] })).status).toBe(400);
    expect((await send('POST', '/teams', { ...dev, id: 'big', members: ['team:dev'] })).status).toBe(201);
    expect((await send('PUT', '/teams/dev', { ...dev, members: ['team:big'] })).status).toBe(400); // cycle
    expect((await send('DELETE', '/agents/nova')).status).toBe(409);
    expect((await send('DELETE', '/teams/dev')).status).toBe(409); // big contains dev
    expect((await (await fetch(`${url}/teams`)).json()).map((t: { id: string; room: number }) => [t.id, t.room])).toEqual([['big', 2], ['dev', 1]]);

    const res = await post(url, body('team1', 'team:dev'));
    const evs = sseEvents(await res.text());
    expect(evs[1]).toMatchObject({ value: { target: 'team:dev', pattern: 'supervisor', main: 'atlas' } });
    expect(evs.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'hello' });
    expect((await post(url, body('team2', 'team:ghost'))).status).toBe(404);
  });

  it('adds an MCP server without restart and lets an allowed agent call its tool', async () => {
    let turn = 0;
    const chat: ChatFn = async () => (async function* () {
      if (turn++ === 0) yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'mcp__demo__echo', arguments: '{"text":"yo"}' } }] } }] };
      else yield { choices: [{ delta: { content: 'done' } }] };
    })();
    const url = await start(chat, createMcp(mkdtempSync(path.join(tmpdir(), 'av-app-mcp-')), { transport: memoryTransport, cleanup: async () => {} }));
    const send = (method: string, p: string, payload?: unknown) => fetch(`${url}${p}`, {
      method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined,
    });
    expect((await send('POST', '/mcp', { name: 'Bad Name', url: 'http://x' })).status).toBe(400);
    const added = await send('POST', '/mcp', { mcpServers: { demo: { url: 'http://unused/mcp' } } });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject([{ name: 'demo', status: 'connected' }]);
    expect((await (await fetch(`${url}/tools`)).json()).find((t: { server: string }) => t.server === 'demo')).toMatchObject({ name: 'mcp__demo__echo' });

    expect((await send('PUT', '/agents/nova', { name: 'Nova', connection: 'c', tools: ['mcp__demo__echo'] })).status).toBe(200);
    expect((await send('PUT', '/agents/nova', { name: 'Nova', connection: 'c', tools: ['mcp__ghost__x'] })).status).toBe(400);
    const evs = sseEvents(await (await post(url, body('mcp1'))).text());
    expect(evs.find((e) => e.type === 'TOOL_CALL_RESULT')).toMatchObject({ content: 'echo: yo' });
    expect((await send('DELETE', '/mcp/demo')).status).toBe(204);
    expect(await (await fetch(`${url}/mcp`)).json()).toEqual([]);
  });

  it('serves workspace files, models and tools', async () => {
    const url = await start();
    files.put('nova', '/work/src/a.py', 'print(1)');
    expect(await (await fetch(`${url}/agents/nova/files`)).json()).toEqual(['src/a.py']);
    expect(await (await fetch(`${url}/agents/nova/files/src/a.py`)).text()).toBe('print(1)');
    const dl = await fetch(`${url}/agents/nova/files/src/a.py?download=true`);
    expect(dl.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''a.py");
    expect((await fetch(`${url}/agents/nova/zip`)).headers.get('content-type')).toBe('application/zip');
    expect((await fetch(`${url}/agents/nova/files/nope.txt`)).status).toBe(404);
    expect((await fetch(`${url}/agents/nova/files/..%2F..%2Fmodels.json`)).status).toBe(400);
    expect((await fetch(`${url}/agents/ghost/files`)).status).toBe(404);
    expect(await (await fetch(`${url}/models`)).json()).toEqual([{ id: 'c', baseURL: 'http://x', defaultModel: 'm' }]);
    expect((await (await fetch(`${url}/tools`)).json()).map((t: { name: string }) => t.name)).toContain('sandbox_run');
  });
});
