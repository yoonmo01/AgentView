import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.ts';
import type { ChatFn } from '../src/store.ts';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

const hello: ChatFn = async () => (async function* () { yield { choices: [{ delta: { content: 'hello' } }] }; })();

async function start(chat: ChatFn = hello) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'av-app-'));
  mkdirSync(path.join(dataDir, 'agents'));
  writeFileSync(path.join(dataDir, 'agents', 'nova.json'), JSON.stringify({ name: 'Nova', connection: 'c', model: 'm' }));
  const app = buildApp({ dataDir, chat, exec: async () => { throw new Error('no docker in this test'); } });
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
    expect(await (await fetch(`${url}/runs`)).json()).toMatchObject([{ runId: 'run1', live: false }]);
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

  it('lists agents with public fields only', async () => {
    const url = await start();
    expect(await (await fetch(`${url}/agents`)).json()).toEqual([
      { id: 'nova', name: 'Nova', role: '', avatar: { model: 'default.glb', color: '#5b8def' } },
    ]);
  });
});
