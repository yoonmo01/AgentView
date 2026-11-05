import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from './store.ts';

/** Where agent and team files lived before they moved into Docker volumes: read once to move them in. */
export const workspaceDir = (dataDir: string, agentId: string) => path.resolve(dataDir, 'workspaces', agentId);
export const teamspaceDir = (dataDir: string, teamId: string) => path.resolve(dataDir, 'teamspaces', teamId);

export const containerName = (agentId: string) => `agentview-${agentId}`;
export const workVolume = (agentId: string) => `agentview-ws-${agentId}`;
export const teamVolume = (teamId: string) => `agentview-team-${teamId}`;

export type ExecResult = { stdout: string; stderr: string; exitCode: number };
type Raw = { stdout: Buffer; stderr: string; exitCode: number };
const MAX_OUT = 100 * 1024 * 1024; // ponytail: whole output in memory, stream it if downloads grow past this

function run(args: string[], opts: { input?: string; signal?: AbortSignal } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args, { signal: opts.signal, stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let size = 0;
    let err = '';
    p.stdout!.on('data', (b: Buffer) => { size += b.length; if (size > MAX_OUT) p.kill(); else out.push(b); });
    p.stderr!.on('data', (b: Buffer) => { err += b; });
    p.on('error', reject); // docker missing, or aborted
    p.on('close', (code) => size > MAX_OUT ? reject(new Error('output larger than 100MB')) : resolve({ stdout: Buffer.concat(out), stderr: err, exitCode: code ?? 1 }));
    if (opts.input !== undefined) p.stdin!.end(opts.input);
  });
}

async function docker(args: string[]): Promise<string> {
  const r = await run(args);
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `docker ${args[0]} exited ${r.exitCode}`);
  return r.stdout.toString().trim();
}

// joining or leaving a team changes the mounts, so it recreates the container like an image change does; v2 = files in volumes
const configLabel = (a: Agent) => `v2|${a.sandbox.image}|net=${a.sandbox.network}|teams=${(a.teams ?? []).join(',')}`;

/** Files from before volumes: move the old host folder aside first so it is copied in only once (the user deletes it later). */
async function moveIn(dir: string, name: string, dest: string): Promise<void> {
  if (!existsSync(dir)) return;
  const moved = `${dir}.moved`;
  if (!(await rename(dir, moved).then(() => true, () => false))) return;
  await docker(['cp', `${moved}${path.sep}.`, `${name}:${dest}`]).catch(async (e) => { await rename(moved, dir).catch(() => {}); throw e; });
}

/** Create, start or recreate the agent's container. Files live in volumes, so recreating is safe. */
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
  const teams = agent.teams ?? [];
  await docker([
    'run', '-d', '--name', name, '--label', `agentview.config=${configLabel(agent)}`,
    ...(agent.sandbox.network ? [] : ['--network', 'none']),
    '--memory', '1g', '--cpus', '1',
    '-v', `${workVolume(agent.id)}:/work`, ...teams.flatMap((t) => ['-v', `${teamVolume(t)}:/team/${t}`]), '-w', '/work',
    agent.sandbox.image, 'tail', '-f', '/dev/null',
  ]);
  await moveIn(workspaceDir(dataDir, agent.id), name, '/work');
  for (const t of teams) await moveIn(teamspaceDir(dataDir, t), name, `/team/${t}`);
}

const idleTimers = new Map<string, NodeJS.Timeout>();
const IDLE_MS = 30 * 60_000;

/** Who to tell when a job waits for a sandbox slot (true) and gets one (false); the runner sets it per agent job. */
export const slotWatch = new AsyncLocalStorage<(waiting: boolean) => void>();
// ponytail: counts the agent sandboxes this server started; MCP server containers are not counted
const MAX_RUNNING = Math.max(1, Number(process.env.AGENTVIEW_MAX_SANDBOXES) || 4);
const live = new Map<string, number>(); // agent → last use, for the sandboxes running now
const busy = new Map<string, number>(); // agent → sandbox uses in progress
let waiters: (() => void)[] = [];

/** Stop a sandbox now. It is out of the running set at once; docker gets 1s since its files are safe in the volume. */
function stopSandbox(agentId: string): Promise<unknown> {
  live.delete(agentId);
  clearTimeout(idleTimers.get(agentId));
  return run(['stop', '-t', '1', containerName(agentId)]);
}

/**
 * At most MAX_RUNNING sandboxes run at once. A new one stops the longest-idle running sandbox to make room;
 * when every running sandbox is busy, the job waits in line until one is free.
 */
async function takeSlot(agentId: string, signal?: AbortSignal): Promise<void> {
  let told = false;
  let evicted: Promise<unknown> | undefined;
  for (;;) {
    signal?.throwIfAborted();
    if (live.has(agentId) || live.size < MAX_RUNNING) break;
    const idle = [...live].filter(([id]) => !busy.get(id)).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (idle) { evicted = stopSandbox(idle); break; } // the freed place is taken below, before any await
    if (!told) { told = true; slotWatch.getStore()?.(true); }
    await new Promise<void>((resolve, reject) => {
      const leave = () => { waiters = waiters.filter((w) => w !== go); reject(signal!.reason); };
      const go = () => { signal?.removeEventListener('abort', leave); resolve(); };
      signal?.addEventListener('abort', leave, { once: true });
      waiters.push(go);
    });
  }
  live.set(agentId, Date.now());
  busy.set(agentId, (busy.get(agentId) ?? 0) + 1);
  if (told) slotWatch.getStore()?.(false);
  await evicted;
}

function freeSlot(agentId: string): void {
  const n = (busy.get(agentId) ?? 1) - 1;
  busy.set(agentId, n);
  if (live.has(agentId)) live.set(agentId, Date.now());
  if (n === 0) idleTimers.set(agentId, setTimeout(() => { void stopSandbox(agentId); }, IDLE_MS).unref());
  const woken = waiters;
  waiters = [];
  woken.forEach((w) => w());
}

/** Every use of the sandbox: wait for a slot, start it if needed, and stop it after 30 idle minutes. */
async function inBox<T>(agent: Agent, dataDir: string, fn: (name: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  clearTimeout(idleTimers.get(agent.id)); // an idle stop from the last job must not hit this one
  await takeSlot(agent.id, signal);
  try {
    await ensureContainer(agent, dataDir);
    return await fn(containerName(agent.id));
  } finally {
    freeSlot(agent.id);
  }
}

export function runInSandbox(agent: Agent, dataDir: string, command: string, timeoutSec: number, signal: AbortSignal): Promise<ExecResult> {
  return inBox(agent, dataDir, async (name) => {
    // Ending the docker CLI leaves the process running inside the container, so cancelling kills the container.
    // The agent runs one job at a time, files stay in the volume, and the next call starts it again.
    const onAbort = () => { void run(['kill', name]); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const raw = await run(['exec', name, 'timeout', '-s', 'KILL', String(timeoutSec), 'sh', '-c', command], { signal });
      const r = { stdout: raw.stdout.toString(), stderr: raw.stderr, exitCode: raw.exitCode };
      if (r.exitCode === 124 || r.exitCode === 137) r.stderr += `\n(stopped: over ${timeoutSec}s or out of memory)`;
      return r;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }, signal);
}

export class NotFound extends Error {}

/** File access inside the agent's sandbox. Paths are container paths already checked by containerPath(). */
export type Files = {
  /** container paths of the files under dir (node_modules and .git skipped), sorted, at most 500 */
  list: (agent: Agent, dir: string) => Promise<string[]>;
  read: (agent: Agent, file: string, maxBytes?: number) => Promise<Buffer>;
  write: (agent: Agent, file: string, content: string) => Promise<void>;
  zip: (agent: Agent, dir: string) => Promise<Buffer>;
};

const MISSING_DIR = '[ -d "$1" ] || { echo "no such folder: $1" >&2; exit 2; }';
const ZIP_PY = `import os, sys, zipfile
root = sys.argv[1]
with zipfile.ZipFile(sys.stdout.buffer, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in ('node_modules', '.git')]
        for f in files:
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, root))`;

export function dockerFiles(dataDir: string): Files {
  const sh = (agent: Agent, script: string, args: string[], input?: string) =>
    inBox(agent, dataDir, (name) => run(['exec', ...(input === undefined ? [] : ['-i']), name, 'sh', '-c', script, 'sh', ...args], { input }))
      .then((r) => {
        if (r.exitCode === 2) throw new NotFound(r.stderr.trim());
        if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `exit code ${r.exitCode}`);
        return r.stdout;
      });
  return {
    list: async (agent, dir) => (await sh(agent, `${MISSING_DIR}; find "$1" \\( -name node_modules -o -name .git \\) -prune -o -type f -print`, [dir]))
      .toString().split('\n').filter(Boolean).sort().slice(0, 500),
    read: (agent, file, maxBytes) => sh(agent,
      '[ -f "$1" ] || { echo "no such file: $1" >&2; exit 2; }; [ "$2" = - ] || [ $(wc -c < "$1") -le "$2" ] || { echo "file larger than $2 bytes: $1" >&2; exit 3; }; cat "$1"',
      [file, maxBytes === undefined ? '-' : String(maxBytes)]),
    write: async (agent, file, content) => { await sh(agent, 'mkdir -p "$(dirname "$1")" && cat > "$1"', [file], content); },
    zip: (agent, dir) => sh(agent, `${MISSING_DIR}; command -v python3 >/dev/null || { echo "the sandbox image has no python3 to make a zip" >&2; exit 3; }; python3 -c "$2" "$1"`, [dir, ZIP_PY]),
  };
}

/** Idle timers live in this process, so at start stop agent sandboxes a previous run left running (the database has no such label). */
export async function stopLeftoverSandboxes(): Promise<void> {
  const ids = (await run(['ps', '-q', '--filter', 'label=agentview.config']).catch(() => null))?.stdout.toString().split(/\s+/).filter(Boolean) ?? [];
  if (ids.length) await run(['stop', ...ids]).catch(() => {});
}

export async function removeContainer(agentId: string): Promise<void> {
  clearTimeout(idleTimers.get(agentId));
  live.delete(agentId);
  await run(['rm', '-f', containerName(agentId)]);
}

/** The agent's files are gone for good: only on an explicit request when deleting the agent. */
export async function removeWorkVolume(agentId: string): Promise<void> {
  await run(['volume', 'rm', '-f', workVolume(agentId)]);
}
