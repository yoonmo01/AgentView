import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Reading public GitHub repositories without git: one tree request lists every path, files come from
 * raw.githubusercontent.com (which does not count against the API rate limit).
 */
export type Repo = { owner: string; repo: string; ref: string };
type TreeItem = { path: string; type: 'blob' | 'tree'; size?: number };

const api = (fetchFn: typeof fetch, url: string) => fetchFn(url, { headers: { Accept: 'application/vnd.github+json' } });

export async function defaultBranch(owner: string, repo: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await api(fetchFn, `https://api.github.com/repos/${owner}/${repo}`);
  if (!res.ok) throw new Error(`GitHub 저장소를 찾지 못했어요 (${res.status}): ${owner}/${repo}`);
  return (await res.json() as { default_branch: string }).default_branch;
}

/** Every file path (and size) in the repository at `ref`. */
export async function tree(r: Repo, fetchFn: typeof fetch = fetch): Promise<{ path: string; size: number }[]> {
  const res = await api(fetchFn, `https://api.github.com/repos/${r.owner}/${r.repo}/git/trees/${encodeURIComponent(r.ref)}?recursive=1`);
  if (!res.ok) throw new Error(`GitHub에서 파일 목록을 읽지 못했어요 (${res.status}): ${r.owner}/${r.repo}@${r.ref}`);
  return (await res.json() as { tree: TreeItem[] }).tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, size: t.size ?? 0 }));
}

export const rawUrl = (r: Repo, p: string) =>
  `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.ref}/${p.split('/').map(encodeURIComponent).join('/')}`;

export async function rawText(r: Repo, p: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(rawUrl(r, p));
  if (!res.ok) throw new Error(`GitHub에서 파일을 받지 못했어요 (${res.status}): ${p}`);
  return res.text();
}

const MAX_FILES = 200;
const MAX_FILE_BYTES = 1_000_000;

/**
 * Download the files under `from` (a folder in the repo) into `into`, keeping their layout.
 * Paths come from GitHub, so each one is checked to stay inside `into`.
 */
export async function downloadDir(r: Repo, files: { path: string; size: number }[], from: string, into: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const prefix = from ? `${from.replace(/\/$/, '')}/` : '';
  const picked = files.filter((f) => f.path.startsWith(prefix) && f.size <= MAX_FILE_BYTES);
  if (picked.length > MAX_FILES) throw new Error(`파일이 ${MAX_FILES}개보다 많아요: ${from}`);
  const root = path.resolve(into);
  for (const f of picked) {
    const rel = f.path.slice(prefix.length);
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep)) throw new Error(`folder escape in ${f.path}`);
    const res = await fetchFn(rawUrl(r, f.path));
    if (!res.ok) throw new Error(`GitHub에서 파일을 받지 못했어요 (${res.status}): ${f.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
  }
  return picked.map((f) => f.path.slice(prefix.length));
}

/** A GitHub address as owner/repo (+ optional ref and folder): "owner/repo", https://github.com/owner/repo[.git], or …/tree/<ref>/<dir>. */
export function parseRepo(s: string): { owner: string; repo: string; ref?: string; dir: string } | null {
  const t = s.trim().replace(/\.git$/, '').replace(/\/$/, '');
  let m = /^([\w.-]+)\/([\w.-]+)$/.exec(t);
  if (m) return { owner: m[1], repo: m[2], dir: '' };
  m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([\w.-]+)(?:\/(.+))?)?$/.exec(t);
  return m ? { owner: m[1], repo: m[2], ref: m[3], dir: m[4] ?? '' } : null;
}
