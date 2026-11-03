import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureContainer, listFiles, readFile, removeContainer, runInSandbox, safePath, teamspaceDir, workspaceDir, writeFile } from '../src/sandbox.ts';
import type { Agent } from '../src/store.ts';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'av-ws-'));

describe('workspace files', () => {
  it('writes, reads and lists files using /work or relative paths', async () => {
    const root = path.join(tmp(), 'nova');
    await writeFile(root, '/work/src/hello.py', 'print("hi")');
    expect(await readFile(root, 'src/hello.py')).toBe('print("hi")');
    expect(await listFiles(root)).toEqual(['src/hello.py']);
  });

  it('rejects traversal and absolute paths outside the workspace', async () => {
    const root = path.join(tmp(), 'nova');
    await expect(safePath(root, '../secret.txt')).rejects.toThrow('outside workspace');
    await expect(safePath(root, path.resolve(tmp(), 'x.txt'))).rejects.toThrow('outside workspace');
  });

  it('rejects escapes through a directory link', async () => {
    const base = tmp();
    const root = path.join(base, 'nova');
    const outside = path.join(base, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.txt'), 's');
    symlinkSync(outside, path.join(root, 'link'), 'junction'); // junction needs no admin rights on Windows
    await expect(readFile(root, 'link/secret.txt')).rejects.toThrow('outside workspace');
    await expect(writeFile(root, 'link/new.txt', 'x')).rejects.toThrow('outside workspace');
  });

  it('skips node_modules and .git when listing', async () => {
    const root = path.join(tmp(), 'nova');
    await writeFile(root, 'a.txt', '1');
    await writeFile(root, 'node_modules/x/i.js', '2');
    await writeFile(root, '.git/HEAD', '3');
    expect(await listFiles(root)).toEqual(['a.txt']);
  });

  it('refuses non-string content', async () => {
    await expect(writeFile(path.join(tmp(), 'nova'), 'a.txt', 42)).rejects.toThrow('content must be a string');
  });
});

const hasDocker = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
const testAgent = (network = false): Agent => ({
  id: 'test-sbx', name: 'T', role: '', connection: 'x', model: 'x', systemPrompt: '', tools: [], maxSteps: 1,
  avatar: { model: 'default.glb', color: '#888888' },
  sandbox: { image: 'busybox:1.36', network },
});
const signal = () => new AbortController().signal;

describe.skipIf(!hasDocker)('agent container', () => {
  const dataDir = tmp();
  afterAll(() => removeContainer('test-sbx'));

  it('runs commands in /work and the files appear on the host', async () => {
    const r = await runInSandbox(testAgent(), dataDir, 'echo hi > note.txt && cat note.txt', 30, signal());
    expect(r).toMatchObject({ exitCode: 0, stdout: 'hi\n' });
    expect(await readFile(workspaceDir(dataDir, 'test-sbx'), 'note.txt')).toBe('hi\n');
  }, 120_000);

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
    const r = await runInSandbox({ ...testAgent(true), teams: ['t1'] }, dataDir, 'echo shared > /team/t1/s.txt && cat note.txt', 30, signal());
    expect(r).toMatchObject({ exitCode: 0, stdout: 'hi\n' });
    expect(await readFile(teamspaceDir(dataDir, 't1'), 's.txt')).toBe('shared\n');
  }, 60_000);

  it('cancel stops the running command', async () => {
    const ac = new AbortController();
    const started = Date.now();
    const run = runInSandbox(testAgent(true), dataDir, 'sleep 30', 60, ac.signal);
    setTimeout(() => ac.abort(), 1000);
    await expect(run).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);
});
