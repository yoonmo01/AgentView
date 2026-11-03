import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listAgents, loadAgent, openaiChat } from '../src/store.ts';

function dataDir(agents: Record<string, unknown> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'av-store-'));
  mkdirSync(path.join(dir, 'agents'));
  for (const [file, body] of Object.entries(agents)) writeFileSync(path.join(dir, 'agents', file), JSON.stringify(body));
  return dir;
}

describe('store', () => {
  it('loads an agent and fills defaults', async () => {
    const dir = dataDir({ 'nova.json': { name: 'Nova', connection: 'baze', model: 'm', tools: ['sandbox_run'] } });
    expect(await loadAgent(dir, 'nova')).toMatchObject({
      id: 'nova', name: 'Nova', maxSteps: 6, tools: ['sandbox_run'],
      sandbox: { image: 'agentview/sandbox:base', network: false },
    });
  });

  it('rejects ids that are not safe file and container names', async () => {
    await expect(loadAgent(dataDir(), '../etc')).rejects.toThrow('invalid agent id');
  });

  it('lists only valid agent files', async () => {
    const dir = dataDir({ 'nova.json': { name: 'Nova' }, 'Bad Name.json': {}, 'notes.txt': {} });
    expect((await listAgents(dir)).map((a) => a.id)).toEqual(['nova']);
  });

  it('reports a missing API key by variable name only', async () => {
    const chat = openaiChat([{ id: 'c', baseURL: 'http://127.0.0.1:9/v1', apiKeyEnv: 'AV_TEST_MISSING_KEY' }]);
    await expect(chat({ connection: 'c', model: 'm', messages: [], tools: [] }, new AbortController().signal))
      .rejects.toThrow('environment variable AV_TEST_MISSING_KEY is not set');
  });
});
