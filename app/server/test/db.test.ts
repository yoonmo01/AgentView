import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, DEFAULT_DB_URL, type Db } from '../src/db.ts';
import { summarizeRun } from '../src/events.ts';
import { buildApp } from '../src/index.ts';
import { createMcp } from '../src/mcp.ts';
import type { ChatFn } from '../src/store.ts';

const schema = `test_${process.pid}_${Date.now()}`;
const db: Db | null = await createDb(process.env.DATABASE_URL ?? DEFAULT_DB_URL, { schema }).catch(() => null);
afterAll(async () => { if (db) { await db.dropSchema(schema); await db.close(); } });

it('summarizes a run into attributed tool steps', () => {
  expect(summarizeRun([
    { type: 'CUSTOM', name: 'agentview.run_info', value: { main: 'atlas' }, timestamp: 0 },
    { type: 'TOOL_CALL_START', toolCallId: 'd', toolCallName: 'delegate', timestamp: 1 },
    { type: 'SUBAGENT_STARTED', subagentRunId: 's', name: 'nova', timestamp: 2 },
    { type: 'TOOL_CALL_START', subagentRunId: 's', toolCallId: 't', toolCallName: 'sandbox_run', timestamp: 3 },
    { type: 'TOOL_CALL_ARGS', subagentRunId: 's', toolCallId: 't', delta: '{"command":"ls"}', timestamp: 3 },
    { type: 'TOOL_CALL_RESULT', subagentRunId: 's', toolCallId: 't', content: 'a.py', timestamp: 13 },
  ])).toEqual([
    { who: 'atlas', tool: 'delegate', args: '', result: '', ms: 0 },
    { who: 'nova', tool: 'sandbox_run', args: '{"command":"ls"}', result: 'a.py', ms: 10 },
  ]);
});

describe.skipIf(!db)('sessions (PostgreSQL)', () => {
  let url = '';
  let close = async () => {};
  beforeAll(async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'av-db-'));
    mkdirSync(path.join(dataDir, 'agents'));
    writeFileSync(path.join(dataDir, 'agents', 'nova.json'), JSON.stringify({ name: 'Nova', connection: 'c', model: 'm' }));
    writeFileSync(path.join(dataDir, 'agents', 'atlas.json'), JSON.stringify({ name: 'Atlas', connection: 'c', model: 'm' }));
    let n = 0;
    const chat: ChatFn = async (req) => (async function* () { yield { choices: [{ delta: { content: `answer ${++n} (${req.model})` } }] }; })();
    // a slow database write: the outcome must still be saved before the stream closes
    const slowDb = { ...db!, add: async (...a: Parameters<Db['add']>) => { await new Promise((r) => setTimeout(r, 50)); return db!.add(...a); } };
    const app = buildApp({ dataDir, chat, db: slowDb, mcp: createMcp(dataDir, { cleanup: async () => {} }), exec: async () => { throw new Error('no docker'); } });
    await app.listen({ host: '127.0.0.1', port: 0 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    close = () => app.close();
  });
  afterAll(() => close());

  const send = (runId: string, messages: { role: string; content: string }[], props: Record<string, string> = { target: 'agent:nova' }) =>
    fetch(`${url}/agui`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: 's1', runId, messages, forwardedProps: props }) })
      .then(async (r) => ({ status: r.status, text: await r.text() }));

  it('keeps a session per thread and continues it across runs', async () => {
    await send('r1', [{ role: 'user', content: 'hello there' }]);
    await send('r2', [{ role: 'user', content: 'hello there' }, { role: 'assistant', content: 'answer 1 (m)' }, { role: 'user', content: 'again' }], { target: 'agent:nova', model: 'other-model' });
    // no waiting: the stream closes only after the outcome is saved
    const list = await (await fetch(`${url}/sessions?target=agent:nova`)).json();
    expect(list).toMatchObject([{ id: 's1', target: 'agent:nova', title: 'hello there' }]);
    const s = await (await fetch(`${url}/sessions/s1`)).json();
    expect(s.messages.map((m: { role: string; content: string; model: string }) => [m.role, m.content, m.model])).toEqual([
      ['user', 'hello there', null], ['assistant', 'answer 1 (m)', 'm'],
      ['user', 'again', 'other-model'], ['assistant', 'answer 2 (other-model)', 'other-model'],
    ]);
  });

  it('refuses to continue a session with a different target, and deletes sessions', async () => {
    expect((await send('r3', [{ role: 'user', content: 'x' }], { target: 'agent:atlas' })).status).toBe(409);
    expect(await (await fetch(`${url}/sessions?target=agent:atlas`)).json()).toEqual([]);
    expect((await fetch(`${url}/sessions/s1`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${url}/sessions/s1`)).status).toBe(404);
  });
});
