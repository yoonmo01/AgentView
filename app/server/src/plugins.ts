import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultBranch, parseRepo, rawText, tree, type Repo } from './github.ts';
import { MCP_NAME, parseConfig, type Mcp } from './mcp.ts';
import { copySkill, deleteSkill, parseSkill, skillIdFor } from './skills.ts';

/**
 * Plugins in the Claude Code format: a marketplace is a GitHub repo with .claude-plugin/marketplace.json listing
 * plugins; a plugin folder may hold skills/, .mcp.json, agents/*.md, commands/ and hooks/.
 * Installing copies its skills into data/skills, registers its MCP servers, and keeps its agents as templates.
 * Hooks would run code on this computer, so they are counted and shown but never run.
 */
type Source = string | { source: string; repo?: string; url?: string; path?: string; ref?: string };
export type MarketPlugin = { name: string; description: string; version?: string; source: Source };
export type Marketplace = { name: string; repo: string; ref: string; plugins: MarketPlugin[] };
export type AgentTemplate = { plugin: string; name: string; description: string; prompt: string };
export type Installed = {
  name: string; marketplace: string; version?: string; description: string;
  skills: string[]; mcp: string[]; agents: AgentTemplate[]; hooks: number; commands: number; notes: string[];
};
type State = { marketplaces: Marketplace[]; installed: Installed[] };

const file = (dataDir: string) => path.join(dataDir, 'plugins.json');
export async function loadPlugins(dataDir: string): Promise<State> {
  return existsSync(file(dataDir)) ? JSON.parse(await readFile(file(dataDir), 'utf8')) as State : { marketplaces: [], installed: [] };
}
const save = async (dataDir: string, s: State) => {
  await mkdir(dataDir, { recursive: true });
  await writeFile(file(dataDir), JSON.stringify(s, null, 2) + '\n');
};

async function readMarketplace(repoText: string, fetchFn: typeof fetch): Promise<Marketplace> {
  const g = parseRepo(repoText);
  if (!g) throw new Error('GitHub 저장소 주소가 아니에요 (예: anthropics/claude-plugins-official)');
  const m = await marketplaceAt({ owner: g.owner, repo: g.repo, ref: g.ref ?? await defaultBranch(g.owner, g.repo, fetchFn) }, fetchFn);
  if (!m) throw new Error('이 저장소에 .claude-plugin/marketplace.json이 없어요');
  return m;
}

/** The repo's plugin list, or null when it has no .claude-plugin/marketplace.json. */
async function marketplaceAt(r: Repo, fetchFn: typeof fetch): Promise<Marketplace | null> {
  let json: { name?: string; plugins?: MarketPlugin[] };
  try {
    json = JSON.parse(await rawText(r, '.claude-plugin/marketplace.json', fetchFn));
  } catch {
    return null;
  }
  const plugins = (json.plugins ?? []).filter((p) => p && typeof p.name === 'string')
    .map((p) => ({ name: p.name, description: String(p.description ?? ''), version: p.version, source: p.source }));
  return { name: String(json.name ?? r.repo), repo: `${r.owner}/${r.repo}`, ref: r.ref, plugins };
}

async function keepMarketplace(dataDir: string, m: Marketplace): Promise<void> {
  const s = await loadPlugins(dataDir);
  s.marketplaces = [...s.marketplaces.filter((x) => x.name !== m.name), m];
  await save(dataDir, s);
}

export async function addMarketplace(dataDir: string, repoText: string, fetchFn: typeof fetch = fetch): Promise<Marketplace> {
  const m = await readMarketplace(repoText, fetchFn);
  await keepMarketplace(dataDir, m);
  return m;
}

/** Marketplaces made for a single plugin repo are named this way; they are not re-read like real ones. */
export const DIRECT = 'github:';

/**
 * One address for both kinds of repo: a marketplace (.claude-plugin/marketplace.json) is added so its plugins can be
 * picked; a single plugin (plugin.json or skills/<name>/SKILL.md) is installed right away.
 */
export async function addFromGitHub(dataDir: string, mcp: Mcp, text: string, fetchFn: typeof fetch = fetch):
  Promise<{ kind: 'marketplace'; marketplace: Marketplace } | { kind: 'plugin'; installed: Installed }> {
  const g = parseRepo(text);
  if (!g) throw new Error('GitHub 주소가 아니에요 (예: obra/superpowers 또는 https://github.com/obra/superpowers)');
  const r: Repo = { owner: g.owner, repo: g.repo, ref: g.ref ?? await defaultBranch(g.owner, g.repo, fetchFn) };
  const market = g.dir ? null : await marketplaceAt(r, fetchFn);
  if (market) {
    await keepMarketplace(dataDir, market);
    return { kind: 'marketplace', marketplace: market };
  }
  const prefix = g.dir ? `${g.dir}/` : '';
  const rels = (await tree(r, fetchFn)).filter((f) => f.path.startsWith(prefix)).map((f) => f.path.slice(prefix.length));
  const manifest = rels.find((p) => p === '.claude-plugin/plugin.json' || p === '.codex-plugin/plugin.json');
  if (!manifest && !rels.some((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p))) {
    throw new Error('플러그인 저장소가 아니에요: marketplace.json도, plugin.json이나 skills/ 폴더도 없어요');
  }
  const meta = manifest ? JSON.parse(await rawText(r, `${prefix}${manifest}`, fetchFn)) as { name?: string; description?: string; version?: string } : {};
  const name = skillIdFor(String(meta.name ?? (g.dir ? path.posix.basename(g.dir) : r.repo)));
  await keepMarketplace(dataDir, {
    name: `${DIRECT}${r.owner}/${r.repo}${g.dir ? `/${g.dir}` : ''}`, repo: `${r.owner}/${r.repo}`, ref: r.ref,
    plugins: [{ name, description: String(meta.description ?? ''), version: meta.version, source: g.dir ? `./${g.dir}` : './' }],
  });
  return { kind: 'plugin', installed: await installPlugin(dataDir, mcp, `${DIRECT}${r.owner}/${r.repo}${g.dir ? `/${g.dir}` : ''}`, name, fetchFn) };
}

export async function removeMarketplace(dataDir: string, name: string): Promise<void> {
  const s = await loadPlugins(dataDir);
  s.marketplaces = s.marketplaces.filter((m) => m.name !== name);
  await save(dataDir, s);
}

/** Where a plugin's folder is: the marketplace repo for a relative path, or another GitHub repo. Other sources are not supported. */
async function locate(m: Marketplace, src: Source, fetchFn: typeof fetch): Promise<{ repo: Repo; dir: string }> {
  const [owner, repo] = m.repo.split('/');
  if (typeof src === 'string') {
    const dir = path.posix.normalize(src.replace(/^\.\//, '')).replace(/\/$/, '').replace(/^\.$/, '');
    if (dir.startsWith('..') || dir.startsWith('/')) throw new Error(`plugin path leaves the repository: ${src}`);
    return { repo: { owner, repo, ref: m.ref }, dir };
  }
  const where = src.source === 'github' ? src.repo : src.url;
  const g = where ? parseRepo(where) : null;
  if (!g || !['github', 'url', 'git-subdir'].includes(src.source)) throw new Error(`이 플러그인 위치 형식은 아직 지원하지 않아요: ${src.source}`);
  const ref = src.ref ?? g.ref ?? await defaultBranch(g.owner, g.repo, fetchFn);
  return { repo: { owner: g.owner, repo: g.repo, ref }, dir: (src.path ?? g.dir ?? '').replace(/^\.?\/|\/$/g, '') };
}

const mcpNameFor = (plugin: string, server: string) => skillIdFor(`${plugin}-${server}`).slice(0, 31).replace(/-+$/, '');

export async function installPlugin(dataDir: string, mcp: Mcp, marketplace: string, name: string, fetchFn: typeof fetch = fetch): Promise<Installed> {
  const s = await loadPlugins(dataDir);
  const m = s.marketplaces.find((x) => x.name === marketplace);
  const entry = m?.plugins.find((p) => p.name === name);
  if (!m || !entry) throw new Error(`플러그인을 찾지 못했어요: ${name}@${marketplace}`);
  if (s.installed.some((p) => p.name === name)) await uninstallPlugin(dataDir, mcp, name); // reinstall = update
  const { repo, dir } = await locate(m, entry.source, fetchFn);
  const all = await tree(repo, fetchFn);
  const prefix = dir ? `${dir}/` : '';
  const files = all.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, rel: f.path.slice(prefix.length) }));
  const notes: string[] = [];

  const skills: string[] = [];
  for (const f of files.filter((x) => /^skills\/[^/]+\/SKILL\.md$/.test(x.rel))) {
    const folder = f.rel.split('/')[1];
    const id = skillIdFor(`${name}-${folder}`);
    await copySkill(dataDir, repo, all, `${prefix}skills/${folder}`, id, `plugin:${name}`, fetchFn);
    skills.push(id);
  }

  const mcpNames: string[] = [];
  const mcpFile = files.find((x) => x.rel === '.mcp.json');
  if (mcpFile) {
    const raw = JSON.parse(await rawText(repo, mcpFile.path, fetchFn)) as Record<string, unknown>;
    const servers = (raw.mcpServers ?? raw) as Record<string, unknown>;
    for (const [server, cfg] of Object.entries(servers)) {
      const config = parseConfig(cfg);
      const mcpName = mcpNameFor(name, server);
      if (typeof config === 'string' || !MCP_NAME.test(mcpName)) { notes.push(`MCP 서버 ${server}: ${typeof config === 'string' ? config : '이름을 만들 수 없음'}`); continue; }
      await mcp.add(mcpName, config);
      mcpNames.push(mcpName);
      if (JSON.stringify(config).includes('${')) notes.push(`MCP 서버 ${mcpName}: 환경 변수(\${...})를 채워야 해요`);
    }
  }

  const agents: AgentTemplate[] = [];
  for (const f of files.filter((x) => /^agents\/[^/]+\.md$/.test(x.rel))) {
    const { meta, body } = parseSkill(await rawText(repo, f.path, fetchFn));
    agents.push({ plugin: name, name: meta.name || path.posix.basename(f.rel, '.md'), description: meta.description ?? '', prompt: body.trim() });
  }

  const installed: Installed = {
    name, marketplace, version: entry.version, description: entry.description, skills, mcp: mcpNames, agents, notes,
    hooks: files.filter((x) => x.rel.startsWith('hooks/')).length,
    commands: files.filter((x) => /^commands\/.+\.md$/.test(x.rel)).length,
  };
  const now = await loadPlugins(dataDir);
  now.installed = [...now.installed.filter((p) => p.name !== name), installed];
  await save(dataDir, now);
  return installed;
}

/** Remove a plugin and everything it registered (its skills and MCP servers). */
export async function uninstallPlugin(dataDir: string, mcp: Mcp, name: string): Promise<void> {
  const s = await loadPlugins(dataDir);
  const p = s.installed.find((x) => x.name === name);
  if (!p) return;
  for (const id of p.skills) await deleteSkill(dataDir, id);
  for (const m of p.mcp) if (mcp.has(m)) await mcp.remove(m);
  s.installed = s.installed.filter((x) => x.name !== name);
  await save(dataDir, s);
}
