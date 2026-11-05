import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Agent } from '../src/store.ts';

process.env.AGENTVIEW_MAX_SANDBOXES = '1'; // read when sandbox.ts loads
const { removeContainer, removeWorkVolume, runInSandbox, slotWatch } = await import('../src/sandbox.ts');

const hasDocker = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
const agent = (id: string): Agent => ({
  id, name: id, role: '', connection: 'x', model: 'x', systemPrompt: '', tools: [], maxSteps: 1,
  avatar: { model: 'default.glb', color: '#888888' }, sandbox: { image: 'busybox:1.36', network: false },
});
const running = (id: string) => spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', `agentview-${id}`]).stdout.toString().trim();
const signal = () => new AbortController().signal;

describe.skipIf(!hasDocker)('running sandbox limit (1 here)', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'av-limit-'));
  afterAll(async () => {
    for (const id of ['lim-a', 'lim-b']) { await removeContainer(id); await removeWorkVolume(id); }
  });

  it('stops the idle sandbox to make room for a new one', async () => {
    await runInSandbox(agent('lim-a'), dataDir, 'true', 30, signal());
    await runInSandbox(agent('lim-b'), dataDir, 'true', 30, signal());
    expect(running('lim-a')).toBe('false');
    expect(running('lim-b')).toBe('true');
  }, 120_000);

  it('makes a job wait while every running sandbox is busy, and tells its watcher', async () => {
    const seen: boolean[] = [];
    const busyA = runInSandbox(agent('lim-a'), dataDir, 'sleep 2', 30, signal());
    await new Promise((r) => setTimeout(r, 300)); // lim-a holds the only slot
    const t0 = Date.now();
    const r = await slotWatch.run((w) => seen.push(w), () => runInSandbox(agent('lim-b'), dataDir, 'echo b', 30, signal()));
    expect(r.stdout).toBe('b\n');
    expect(Date.now() - t0).toBeGreaterThan(1000); // waited for lim-a to finish
    expect(seen).toEqual([true, false]);
    expect(await busyA).toMatchObject({ exitCode: 0 });
  }, 120_000);
});
