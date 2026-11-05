import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Packages } from './store.ts';

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
const configLabel = (a: Agent, image: string) => `v2|${image}|net=${a.sandbox.network}|teams=${(a.teams ?? []).join(',')}`;

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
  const image = await imageFor(agent); // a newly built package image swaps the container on its next use; files stay in the volume
  const state = await docker(['inspect', '-f', '{{.State.Running}} {{index .Config.Labels "agentview.config"}}', name]).catch(() => null);
  if (state !== null) {
    const [running, ...label] = state.split(' ');
    if (label.join(' ') === configLabel(agent, image)) {
      if (running !== 'true') await docker(['start', name]);
      return;
    }
    await docker(['rm', '-f', name]);
  }
  const teams = agent.teams ?? [];
  await docker([
    'run', '-d', '--name', name, '--label', `agentview.config=${configLabel(agent, image)}`,
    ...(agent.sandbox.network ? [] : ['--network', 'none']),
    '--memory', '1g', '--cpus', '1',
    '-v', `${workVolume(agent.id)}:/work`, ...teams.flatMap((t) => ['-v', `${teamVolume(t)}:/team/${t}`]), '-w', '/work',
    image, 'tail', '-f', '/dev/null',
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
  /** lines matching a regular expression under dir, as "path:line:text", at most 200 */
  search: (agent: Agent, dir: string, pattern: string) => Promise<string[]>;
  /** a web page as plain text, fetched from inside the sandbox (so only agents with internet can reach the web) */
  fetchText: (agent: Agent, url: string) => Promise<string>;
};

const MISSING_DIR = '[ -d "$1" ] || { echo "no such folder: $1" >&2; exit 2; }';
/** Fetch one http(s) page (1MB at most, 20s) and reduce HTML to readable text. */
const FETCH_PY = String.raw`import html, re, sys, urllib.request
url = sys.argv[1]
if not re.match(r'^https?://', url): sys.exit('only http and https addresses')
req = urllib.request.Request(url, headers={'User-Agent': 'AgentView-sandbox'})
with urllib.request.urlopen(req, timeout=20) as r:
    body = r.read(1_000_000).decode(r.headers.get_content_charset() or 'utf-8', 'replace')
    kind = r.headers.get_content_type()
if 'html' in kind:
    body = re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>', ' ', body)
    body = re.sub(r'(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr)>', '\n', body)
    body = html.unescape(re.sub(r'<[^>]+>', ' ', body))
print(re.sub(r'[ \t]+', ' ', re.sub(r'\n\s*\n+', '\n\n', body)).strip())`;
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
    search: async (agent, dir, pattern) => (await sh(agent,
      // grep exits 1 when nothing matches: that is an empty result, not an error
      `${MISSING_DIR}; grep -rnIE --exclude-dir=node_modules --exclude-dir=.git -e "$2" "$1" | head -200; exit 0`, [dir, pattern]))
      .toString().split('\n').filter(Boolean),
    fetchText: async (agent, url) => (await sh(agent,
      'command -v python3 >/dev/null || { echo "the sandbox image has no python3 to fetch pages" >&2; exit 3; }; python3 -c "$2" "$1"', [url, FETCH_PY])).toString(),
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

/** Package names that may go into a Dockerfile RUN line: name, optionally a version spec, nothing that a shell would read. */
export const PKG = {
  pip: /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?([=<>!~]=?[A-Za-z0-9.*+-]+)?$/,
  npm: /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9.^~*+-]+)?$/,
  apt: /^[a-z0-9][a-z0-9+.-]*(=[A-Za-z0-9.:~+-]+)?$/,
};
const ENV_REPO = 'agentview/sandbox-env';
const hasPackages = (p?: Packages) => !!p && (p.pip.length + p.npm.length + p.apt.length) > 0;

/** The image an agent's extra packages make: named by a hash of the base image and the sorted package lists, so equal setups share it. */
export function envTag(a: Agent): string | null {
  const p = a.sandbox.packages;
  if (!hasPackages(p)) return null;
  const key = JSON.stringify([a.sandbox.image, ...(['apt', 'pip', 'npm'] as const).map((k) => [...p![k]].sort())]);
  return `${ENV_REPO}:${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

export function dockerfile(a: Agent): string {
  const p = a.sandbox.packages!;
  const bad = (['pip', 'npm', 'apt'] as const).flatMap((k) => p[k].filter((n) => !PKG[k].test(n)));
  if (bad.length) throw new Error(`invalid package name: ${bad.join(', ')}`); // checked at the API too; this guards the RUN line
  return [
    `FROM ${a.sandbox.image}`,
    p.apt.length && `RUN apt-get update && apt-get install -y --no-install-recommends ${p.apt.join(' ')} && rm -rf /var/lib/apt/lists/*`,
    p.pip.length && `RUN pip install --no-cache-dir ${p.pip.join(' ')}`,
    p.npm.length && `RUN npm install -g ${p.npm.join(' ')}`,
  ].filter(Boolean).join('\n') + '\n';
}

type Build = { status: 'building' | 'ready' | 'failed'; log: string };
const builds = new Map<string, Build>();
const imageExists = async (tag: string) => (await run(['image', 'inspect', tag]).catch(() => null))?.exitCode === 0;

/**
 * Build the agent's image with its extra packages, once per tag. Building has internet even when the sandbox has none.
 * The log fills as it goes, so the settings screen can show progress.
 */
export async function prepareEnv(a: Agent): Promise<void> {
  const tag = envTag(a);
  if (!tag || builds.get(tag)?.status === 'building' || await imageExists(tag)) return;
  const b: Build = { status: 'building', log: '' };
  builds.set(tag, b);
  const add = (s: string) => { b.log = (b.log + s).slice(-20_000); };
  try {
    const file = dockerfile(a);
    const code = await new Promise<number>((resolve, reject) => {
      const p = spawn('docker', ['build', '--progress=plain', '-t', tag, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
      p.stdout!.on('data', (d: Buffer) => add(d.toString()));
      p.stderr!.on('data', (d: Buffer) => add(d.toString()));
      p.on('error', reject);
      p.on('close', (c) => resolve(c ?? 1));
      p.stdin!.end(file);
    });
    b.status = code === 0 ? 'ready' : 'failed';
  } catch (e) {
    add(`\n${(e as Error).message}`);
    b.status = 'failed';
  }
}

/** The image the agent runs now: its package image once built, else the base image (and the build starts). */
async function imageFor(a: Agent): Promise<string> {
  const tag = envTag(a);
  if (!tag) return a.sandbox.image;
  if (await imageExists(tag)) return tag;
  void prepareEnv(a);
  return a.sandbox.image;
}

/** For the settings screen: the image in use and the build of the package image. */
export async function envState(a: Agent): Promise<{ base: string; tag: string | null; status: 'none' | Build['status']; log: string }> {
  const tag = envTag(a);
  if (!tag) return { base: a.sandbox.image, tag, status: 'none', log: '' };
  const b = builds.get(tag);
  if (b) return { base: a.sandbox.image, tag, ...b };
  return { base: a.sandbox.image, tag, status: await imageExists(tag) ? 'ready' : 'building', log: '' };
}

/** Remove package images no agent asks for any more (an image a container still uses is kept by docker). */
export async function pruneEnvImages(agents: Agent[]): Promise<void> {
  const wanted = new Set(agents.map(envTag).filter(Boolean));
  const out = (await run(['images', ENV_REPO, '--format', '{{.Repository}}:{{.Tag}}']).catch(() => null))?.stdout.toString() ?? '';
  for (const tag of out.split(/\s+/).filter(Boolean)) if (!wanted.has(tag)) { builds.delete(tag); await run(['rmi', tag]).catch(() => {}); }
}
