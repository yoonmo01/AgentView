import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignColor, assignRoom, TEAM_COLORS, checkTeam, listAgents, loadAgent, openaiChat, resolve, teamWithDefaults, type Team } from '../src/store.ts';

const t = (id: string, main: string, members: string[], room: number | null = null): Team =>
  teamWithDefaults({ pattern: 'parallel', main, members, room }, id);

describe('teams', () => {
  const agents = new Set(['atlas', 'nova', 'milo']);
  it('checks references, self-membership and nesting cycles', () => {
    const b = t('b', 'atlas', ['nova', 'team:a']);
    const teams = new Map([['b', b]]);
    expect(checkTeam(t('a', 'atlas', ['nova']), agents, teams)).toBeNull();
    expect(checkTeam(t('a', 'ghost', ['nova']), agents, teams)).toMatch('unknown main');
    expect(checkTeam(t('a', 'atlas', ['atlas']), agents, teams)).toMatch('main agent cannot');
    expect(checkTeam(t('a', 'atlas', ['team:zzz']), agents, teams)).toMatch('unknown member');
    expect(checkTeam(t('a', 'atlas', ['team:b']), agents, teams)).toMatch('cycle'); // a ⊃ b ⊃ a
    expect(checkTeam(t('a', 'atlas', ['team:a']), agents, teams)).toMatch('cycle');
  });

  it('keeps a room, takes the lowest free one, or none when full', () => {
    const others = [t('x', 'atlas', ['nova'], 1), t('y', 'atlas', ['nova'], 3)];
    expect(assignRoom(t('new', 'atlas', ['nova']), others)).toBe(2);
    expect(assignRoom(t('y', 'atlas', ['nova']), others)).toBe(3);
    expect(assignRoom(t('new', 'atlas', ['nova']), [1, 2, 3, 4].map((r) => t(`t${r}`, 'atlas', ['nova'], r)))).toBeNull();
  });

  it('keeps a given or previous color, else takes an unused one', () => {
    const others = [{ ...t('x', 'atlas', ['nova']), color: TEAM_COLORS[0] }];
    expect(assignColor(t('new', 'atlas', ['nova']), others)).toBe(TEAM_COLORS[1]);
    expect(assignColor(t('x', 'atlas', ['nova']), others)).toBe(TEAM_COLORS[0]);
    expect(assignColor({ ...t('new', 'atlas', ['nova']), color: '#123456' }, others)).toBe('#123456');
  });

  it('resolves a team target into a snapshot with every member and their teams', async () => {
    const dir = dataDir({ 'atlas.json': { name: 'A' }, 'nova.json': { name: 'N' }, 'milo.json': { name: 'M' } });
    mkdirSync(path.join(dir, 'teams'));
    writeFileSync(path.join(dir, 'teams', 'outer.json'), JSON.stringify({ pattern: 'supervisor', main: 'atlas', members: ['team:inner'] }));
    writeFileSync(path.join(dir, 'teams', 'inner.json'), JSON.stringify({ pattern: 'debate', main: 'milo', members: ['nova'] }));
    const defs = await resolve(dir, 'team:outer');
    expect([...defs.teams.keys()]).toEqual(['outer', 'inner']);
    expect([...defs.agents.keys()].sort()).toEqual(['atlas', 'milo', 'nova']);
    expect(defs.agents.get('nova')!.teams).toEqual(['inner']);
    expect(defs.teams.get('inner')!.limits.rounds).toBe(2);
  });
});

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
