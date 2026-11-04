import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile as fsReadFile, readdir, realpath, stat, writeFile as fsWriteFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from './store.ts';

export const workspaceDir = (dataDir: string, agentId: string) => path.resolve(dataDir, 'workspaces', agentId);

const inside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/** Resolve an agent-supplied path ("/work/a.py" or "a.py") inside root; reject traversal and link escapes. */
export async function safePath(root: string, rel: string): Promise<string> {
  if (typeof rel !== 'string' || rel === '') throw new Error('path is required');
  await mkdir(root, { recursive: true });
  const p = path.resolve(root, rel.replace(/^\/work(\/|$)/, ''));
  if (!inside(root, p)) throw new Error(`path outside workspace: ${rel}`);
  let probe = p;
  while (!existsSync(probe)) probe = path.dirname(probe); // deepest existing ancestor
  if (!inside(await realpath(root), await realpath(probe))) throw new Error(`path outside workspace: ${rel}`);
  return p;
}

const SKIP = new Set(['node_modules', '.git']);

export async function listFiles(root: string, dir = '.', limit = 500): Promise<string[]> {
  const base = await safePath(root, dir);
  const entries = await readdir(base, { recursive: true, withFileTypes: true });
  return entries
    .filter((d) => d.isFile())
    .map((d) => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
    .filter((p) => !p.split('/').some((seg) => SKIP.has(seg)))
    .sort()
    .slice(0, limit);
}

export async function readFile(root: string, rel: string): Promise<string> {
  const p = await safePath(root, rel);
  if ((await stat(p)).size > 1_000_000) throw new Error(`file larger than 1MB: ${rel}`);
  return fsReadFile(p, 'utf8');
}

export async function writeFile(root: string, rel: string, content: unknown): Promise<void> {
  if (typeof content !== 'string') throw new Error('content must be a string');
  const p = await safePath(root, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await fsWriteFile(p, content);
}

export type ExecResult = { stdout: string; stderr: string; exitCode: number };

function run(args: string[], signal?: AbortSignal): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { maxBuffer: 10 * 1024 * 1024, signal }, (err, stdout, stderr) => {
      const code = (err as { code?: unknown } | null)?.code;
      if (err && typeof code !== 'number') return reject(err); // docker missing, or aborted
      resolve({ stdout, stderr, exitCode: typeof code === 'number' ? code : 0 });
    });
  });
}

async function docker(args: string[]): Promise<string> {
  const r = await run(args);
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `docker ${args[0]} exited ${r.exitCode}`);
  return r.stdout.trim();
}

export const containerName = (agentId: string) => `agentview-${agentId}`;
const configLabel = (a: Agent) => `${a.sandbox.image}|net=${a.sandbox.network}`;

/** Create, start or recreate the agent's container. Files live on the host, so recreating is safe. */
export async function ensureContainer(agent: Agent, dataDir: string): Promise<void> {
  const name = containerName(agent.id);
  const state = await docker(['inspect', '-f', '{{.State.Running}} {{index .Config.Labels "agentview.config"}}', name]).catch(() => null);
  if (state !== null) {
    const [running, ...label] = state.split(' ');
    if (label.join(' ') === configLabel(agent)) {
      if (running !== 'true') await docker(['start', name]);
      return;
    }
    await docker(['rm', '-f', name]);
  }
  const ws = workspaceDir(dataDir, agent.id);
  await mkdir(ws, { recursive: true });
  await docker([
    'run', '-d', '--name', name, '--label', `agentview.config=${configLabel(agent)}`,
    ...(agent.sandbox.network ? [] : ['--network', 'none']),
    '--memory', '1g', '--cpus', '1',
    '-v', `${ws}:/work`, '-w', '/work',
    agent.sandbox.image, 'tail', '-f', '/dev/null',
  ]);
}

const idleTimers = new Map<string, NodeJS.Timeout>();
const IDLE_MS = 30 * 60_000;

export async function runInSandbox(agent: Agent, dataDir: string, command: string, timeoutSec: number, signal: AbortSignal): Promise<ExecResult> {
  await ensureContainer(agent, dataDir);
  const name = containerName(agent.id);
  // Ending the docker CLI leaves the process running inside the container, so cancelling kills the container.
  // The agent runs one job at a time, files stay on the host, and the next call starts it again.
  const onAbort = () => { void run(['kill', name]); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await run(['exec', name, 'timeout', '-s', 'KILL', String(timeoutSec), 'sh', '-c', command], signal);
    if (r.exitCode === 124 || r.exitCode === 137) r.stderr += `\n(stopped: over ${timeoutSec}s or out of memory)`;
    return r;
  } finally {
    signal.removeEventListener('abort', onAbort);
    clearTimeout(idleTimers.get(agent.id));
    idleTimers.set(agent.id, setTimeout(() => { void run(['stop', name]); }, IDLE_MS).unref());
  }
}

export async function removeContainer(agentId: string): Promise<void> {
  clearTimeout(idleTimers.get(agentId));
  await run(['rm', '-f', containerName(agentId)]);
}
