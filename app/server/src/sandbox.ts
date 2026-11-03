import { existsSync } from 'node:fs';
import { mkdir, readFile as fsReadFile, readdir, realpath, stat, writeFile as fsWriteFile } from 'node:fs/promises';
import path from 'node:path';

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
