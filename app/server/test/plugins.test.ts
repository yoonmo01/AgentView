import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMcp } from '../src/mcp.ts';
import { addMarketplace, installPlugin, loadPlugins, uninstallPlugin } from '../src/plugins.ts';
import { listSkills, loadSkill } from '../src/skills.ts';
import { fakeGithub } from './fakeGithub.ts';
import { memoryTransport } from './mcp.test.ts';

const repos = {
  'acme/market': {
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'acme', plugins: [
      { name: 'helper', description: 'helps', version: '1.0.0', source: './plugins/helper' },
      { name: 'outside', description: 'lives elsewhere', source: { source: 'github', repo: 'acme/outside' } },
      { name: 'odd', description: 'unknown source', source: { source: 'npm', package: 'x' } },
    ] }),
    'plugins/helper/skills/review/SKILL.md': '---\nname: review\ndescription: reviews code\n---\nsteps',
    'plugins/helper/skills/review/check.md': 'list',
    'plugins/helper/.mcp.json': JSON.stringify({ mcpServers: { tools: { command: 'mcp-server-everything', args: ['stdio'] } } }),
    'plugins/helper/agents/critic.md': '---\nname: critic\ndescription: finds problems\n---\nYou are a careful critic.',
    'plugins/helper/hooks/hooks.json': '{}',
    'plugins/helper/commands/go.md': 'go',
    'plugins/other/skills/x/SKILL.md': '---\nname: x\n---\n',
  },
  'acme/outside': { 'skills/solo/SKILL.md': '---\nname: solo\ndescription: alone\n---\n' },
};

describe('plugins', () => {
  it('adds a marketplace, installs a plugin into skills, MCP and agent templates, and removes it all again', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'av-plugins-'));
    const gh = fakeGithub(repos);
    const mcp = createMcp(dir, { transport: memoryTransport, cleanup: async () => {} });
    const m = await addMarketplace(dir, 'acme/market', gh);
    expect(m).toMatchObject({ name: 'acme', repo: 'acme/market', ref: 'main' });
    expect(m.plugins.map((p) => p.name)).toEqual(['helper', 'outside', 'odd']);

    const p = await installPlugin(dir, mcp, 'acme', 'helper', gh);
    expect(p).toMatchObject({ skills: ['helper-review'], mcp: ['helper-tools'], hooks: 1, commands: 1 });
    expect(p.agents).toEqual([{ plugin: 'helper', name: 'critic', description: 'finds problems', prompt: 'You are a careful critic.' }]);
    expect(await loadSkill(dir, 'helper-review')).toMatchObject({ source: 'plugin:helper', files: ['SKILL.md', 'check.md'] });
    expect(mcp.has('helper-tools')).toBe(true);
    expect((await listSkills(dir)).map((s) => s.id)).toEqual(['helper-review']); // plugins/other is not part of it

    expect((await installPlugin(dir, mcp, 'acme', 'outside', gh)).skills).toEqual(['outside-solo']);
    await expect(installPlugin(dir, mcp, 'acme', 'odd', gh)).rejects.toThrow('지원하지 않아요');

    await uninstallPlugin(dir, mcp, 'helper');
    expect(mcp.has('helper-tools')).toBe(false);
    expect((await listSkills(dir)).map((s) => s.id)).toEqual(['outside-solo']);
    expect((await loadPlugins(dir)).installed.map((x) => x.name)).toEqual(['outside']);
    await mcp.closeAll();
  });

  it('refuses a repo without a marketplace file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'av-plugins-'));
    await expect(addMarketplace(dir, 'acme/outside', fakeGithub(repos))).rejects.toThrow('marketplace.json이 없어요');
    await expect(addMarketplace(dir, 'not a repo', fakeGithub(repos))).rejects.toThrow('GitHub 저장소 주소');
  });
});
