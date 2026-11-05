import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dockerFiles, ensureContainer, NotFound, removeContainer, removeWorkVolume, runInSandbox, teamVolume, workspaceDir } from '../src/sandbox.ts';
import type { Agent } from '../src/store.ts';

const hasDocker = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
const hasImage = hasDocker && spawnSync('docker', ['image', 'inspect', 'agentview/sandbox:base'], { stdio: 'ignore' }).status === 0;
const testAgent = (network = false, image = 'busybox:1.36'): Agent => ({
  id: 'test-sbx', name: 'T', role: '', connection: 'x', model: 'x', systemPrompt: '', tools: [], maxSteps: 1,
  avatar: { model: 'default.glb', color: '#888888' },
  sandbox: { image, network },
});
const signal = () => new AbortController().signal;

describe.skipIf(!hasDocker)('agent container', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'av-ws-'));
  const files = dockerFiles(dataDir);
  // files from before volumes: moved in once when the container is first made
  mkdirSync(workspaceDir(dataDir, 'test-sbx'), { recursive: true });
  writeFileSync(path.join(workspaceDir(dataDir, 'test-sbx'), 'old.txt'), 'from the host');
  afterAll(async () => {
    await removeContainer('test-sbx');
    await removeWorkVolume('test-sbx');
    spawnSync('docker', ['volume', 'rm', '-f', teamVolume('t1')]);
  });

  it('runs commands in /work, which keeps the old host files moved in', async () => {
    const r = await runInSandbox(testAgent(), dataDir, 'echo hi > note.txt && cat note.txt old.txt', 30, signal());
    expect(r).toMatchObject({ exitCode: 0, stdout: 'hi\nfrom the host' });
    expect(existsSync(workspaceDir(dataDir, 'test-sbx'))).toBe(false); // moved aside, not copied again
    expect(existsSync(`${workspaceDir(dataDir, 'test-sbx')}.moved`)).toBe(true);
  }, 120_000);

  it('writes, reads and lists files inside the sandbox', async () => {
    await files.write(testAgent(), '/work/src/a b.py', 'print(1)\n');
    expect((await files.read(testAgent(), '/work/src/a b.py')).toString()).toBe('print(1)\n');
    expect(await files.list(testAgent(), '/work')).toEqual(['/work/note.txt', '/work/old.txt', '/work/src/a b.py']);
    await expect(files.read(testAgent(), '/work/nope.txt')).rejects.toBeInstanceOf(NotFound);
    await expect(files.read(testAgent(), '/work/note.txt', 1)).rejects.toThrow('larger than 1 bytes');
  }, 60_000);

  it('kills commands that run too long', async () => {
    const r = await runInSandbox(testAgent(), dataDir, 'sleep 5', 1, signal());
    expect([124, 137]).toContain(r.exitCode);
  }, 60_000);

  it('recreates the container when settings change and keeps files', async () => {
    await ensureContainer(testAgent(true), dataDir);
    const r = await runInSandbox(testAgent(true), dataDir, 'cat note.txt', 30, signal());
    expect(r.stdout).toBe('hi\n');
  }, 60_000);

  it('mounts team shared folders when the agent joins a team', async () => {
    const member = { ...testAgent(true), teams: ['t1'] };
    const r = await runInSandbox(member, dataDir, 'echo shared > /team/t1/s.txt && cat note.txt', 30, signal());
    expect(r).toMatchObject({ exitCode: 0, stdout: 'hi\n' });
    expect((await files.read(member, '/team/t1/s.txt')).toString()).toBe('shared\n');
  }, 60_000);

  it('cancel stops the running command', async () => {
    const ac = new AbortController();
    const started = Date.now();
    const run = runInSandbox(testAgent(true), dataDir, 'sleep 30', 60, ac.signal);
    setTimeout(() => ac.abort(), 1000);
    await expect(run).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);

  it.skipIf(!hasImage)('zips the workspace', async () => {
    const zip = await files.zip(testAgent(true, 'agentview/sandbox:base'), '/work');
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.includes(Buffer.from('src/a b.py'))).toBe(true);
  }, 120_000);
});
