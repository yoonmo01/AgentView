import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadDir, tree, type Repo } from './github.ts';

/**
 * Skills: a folder with SKILL.md (front matter `name`, `description`, optional `allowed-tools`, then the procedure)
 * and any files it uses. Same format as Claude Code and Codex skills.
 * They are definitions like agents and teams, so they live in data/skills; sandboxes see them read-only at /skills.
 */
export const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
export type Skill = { id: string; name: string; description: string; allowedTools: string[]; source: string; files: string[] };

export const skillsDir = (dataDir: string) => path.resolve(dataDir, 'skills');
const dirOf = (dataDir: string, id: string) => {
  if (!SKILL_ID.test(id)) throw new Error(`invalid skill id: ${id}`);
  return path.join(skillsDir(dataDir), id);
};

/** The front matter of SKILL.md (simple `key: value` lines, lists as `[a, b]` or `a, b`) and the body after it. */
export function parseSkill(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: m[2] };
}
export const toolList = (v = '') => v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

export function skillText(s: { name: string; description: string; allowedTools: string[]; body: string }): string {
  const one = (v: string) => v.replace(/\s*\n\s*/g, ' ').trim(); // front matter values stay on one line
  return `---\nname: ${one(s.name)}\ndescription: ${one(s.description)}\n${s.allowedTools.length ? `allowed-tools: ${s.allowedTools.join(', ')}\n` : ''}---\n\n${s.body.trim()}\n`;
}

async function filesIn(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await filesIn(dir, p)); else out.push(p);
  }
  return out.sort();
}

export async function loadSkill(dataDir: string, id: string): Promise<Skill & { body: string }> {
  const dir = dirOf(dataDir, id);
  const { meta, body } = parseSkill(await readFile(path.join(dir, 'SKILL.md'), 'utf8'));
  const source = existsSync(path.join(dir, '.source')) ? (await readFile(path.join(dir, '.source'), 'utf8')).trim() : 'local';
  return { id, name: meta.name || id, description: meta.description ?? '', allowedTools: toolList(meta['allowed-tools']), source, files: await filesIn(dir), body };
}

export async function listSkills(dataDir: string): Promise<Skill[]> {
  const root = skillsDir(dataDir);
  if (!existsSync(root)) return [];
  const ids = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && SKILL_ID.test(e.name) && existsSync(path.join(root, e.name, 'SKILL.md'))).map((e) => e.name);
  return Promise.all(ids.sort().map(async (id) => { const { body: _b, ...s } = await loadSkill(dataDir, id); return s; }));
}

/** Write a skill made on the settings screen (replaces its SKILL.md; other files stay). */
export async function saveSkill(dataDir: string, id: string, s: { name: string; description: string; allowedTools: string[]; body: string }): Promise<void> {
  const dir = dirOf(dataDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), skillText(s));
}

export const deleteSkill = (dataDir: string, id: string) => rm(dirOf(dataDir, id), { recursive: true, force: true });

/** A GitHub folder address: https://github.com/<owner>/<repo>/tree/<ref>/<path> (or a blob link to its SKILL.md). */
export function parseGitHub(url: string): { owner: string; repo: string; ref: string; dir: string } | null {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:tree|blob)\/([\w./-]+?)\/(.+?)\/?$/.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3], dir: m[4].replace(/\/SKILL\.md$/, '') };
}

export const skillIdFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Copy one skill folder of a GitHub repo (`files`: the repo tree) into data/skills/<id>, marking where it came from. */
export async function copySkill(dataDir: string, r: Repo, files: { path: string; size: number }[], from: string, id: string, source: string, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!files.some((f) => f.path === `${from}/SKILL.md`)) throw new Error(`이 폴더에 SKILL.md가 없어요: ${from}`);
  const dir = dirOf(dataDir, id);
  await rm(dir, { recursive: true, force: true });
  await downloadDir(r, files, from, dir, fetchFn);
  await writeFile(path.join(dir, '.source'), source);
}

/** Copy a skill folder from a public GitHub repository into data/skills/<id>. */
export async function importSkill(dataDir: string, url: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const g = parseGitHub(url);
  if (!g) throw new Error('GitHub 폴더 주소가 아니에요 (예: https://github.com/<owner>/<repo>/tree/main/skills/<이름>)');
  const id = skillIdFor(path.posix.basename(g.dir));
  if (!SKILL_ID.test(id)) throw new Error(`이 폴더 이름으로는 스킬 ID를 만들 수 없어요: ${g.dir}`);
  await copySkill(dataDir, g, await tree(g, fetchFn), g.dir, id, url.trim(), fetchFn);
  return id;
}

/** Claude Code / Codex tool names a skill may mention, and the AgentView tool that does the same. */
const SAME_TOOL = 'Read→sandbox_read_file, Write→sandbox_write_file, Edit→sandbox_edit_file, Bash→sandbox_run, Grep/Glob→sandbox_search, LS→sandbox_list_files, WebFetch→web_fetch';

/** The system note that tells an agent which skills it has: names and one-liners only, the rest is read on demand. */
export function skillBrief(skills: Skill[]): string {
  if (!skills.length) return '';
  return [
    '## 사용할 수 있는 스킬',
    '일이 아래 스킬과 맞으면, 먼저 sandbox_read_file로 그 스킬의 SKILL.md를 읽고 적힌 절차를 따르세요. 스킬 폴더의 다른 파일도 필요하면 읽으세요(읽기 전용).',
    '사용자가 스킬 이름을 직접 말하면 반드시 그 스킬을 쓰세요.',
    ...skills.map((s) => `- ${s.name}: ${s.description} (/skills/${s.id}/SKILL.md)`),
    `스킬에 다른 도구 이름이 나오면 이렇게 바꿔 쓰세요: ${SAME_TOOL}`,
  ].join('\n');
}
