import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { importSkill, listSkills, loadSkill, parseGitHub, parseSkill, saveSkill, skillBrief, skillText } from '../src/skills.ts';
import { resolve, saveAgent, withDefaults } from '../src/store.ts';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'av-skills-'));

/** A fake GitHub: folder listings from the contents API and raw file downloads. */
function github(tree: Record<string, string>): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const listing = /\/contents\/(.+?)\?ref=/.exec(url);
    if (listing) {
      const dir = decodeURIComponent(listing[1]);
      const kids = new Map<string, 'file' | 'dir'>();
      for (const p of Object.keys(tree)) if (p.startsWith(`${dir}/`)) {
        const rest = p.slice(dir.length + 1).split('/');
        kids.set(`${dir}/${rest[0]}`, rest.length > 1 ? 'dir' : 'file');
      }
      if (!kids.size) return new Response('not found', { status: 404 });
      return Response.json([...kids].map(([p, type]) => ({ type, name: path.posix.basename(p), path: p, size: 10, download_url: type === 'file' ? `https://raw/${p}` : null })));
    }
    const raw = url.replace('https://raw/', '');
    return raw in tree ? new Response(tree[raw]) : new Response('missing', { status: 404 });
  }) as typeof fetch;
}

describe('skills', () => {
  it('reads and writes SKILL.md front matter', () => {
    const text = skillText({ name: '보고서', description: 'PDF 보고서를 만든다\n두 줄', allowedTools: ['Read', 'Bash'], body: '1. 자료를 모은다' });
    expect(text).toBe('---\nname: 보고서\ndescription: PDF 보고서를 만든다 두 줄\nallowed-tools: Read, Bash\n---\n\n1. 자료를 모은다\n');
    expect(parseSkill(text).meta).toEqual({ name: '보고서', description: 'PDF 보고서를 만든다 두 줄', 'allowed-tools': 'Read, Bash' });
    expect(parseSkill('no front matter').body).toBe('no front matter');
  });

  it('saves, lists and loads skills made here', async () => {
    const dir = tmp();
    await saveSkill(dir, 'review', { name: '코드 리뷰', description: '체크리스트로 리뷰한다', allowedTools: ['sandbox_read_file'], body: '- 테스트가 있는지' });
    expect(await listSkills(dir)).toEqual([{ id: 'review', name: '코드 리뷰', description: '체크리스트로 리뷰한다', allowedTools: ['sandbox_read_file'], source: 'local', files: ['SKILL.md'] }]);
    expect((await loadSkill(dir, 'review')).body).toBe('\n- 테스트가 있는지\n');
  });

  it('copies a skill folder from GitHub, keeping its files inside the skill folder', async () => {
    expect(parseGitHub('https://github.com/acme/skills/tree/main/skills/pdf-report')).toEqual({ owner: 'acme', repo: 'skills', ref: 'main', dir: 'skills/pdf-report' });
    expect(parseGitHub('https://github.com/acme/skills/blob/main/skills/pdf-report/SKILL.md')?.dir).toBe('skills/pdf-report');
    expect(parseGitHub('https://example.com/x')).toBeNull();
    const dir = tmp();
    const id = await importSkill(dir, 'https://github.com/acme/skills/tree/main/skills/pdf-report', github({
      'skills/pdf-report/SKILL.md': '---\nname: pdf\ndescription: makes PDFs\n---\nsteps',
      'skills/pdf-report/scripts/make.py': 'print(1)',
    }));
    expect(id).toBe('pdf-report');
    expect(await loadSkill(dir, id)).toMatchObject({ name: 'pdf', source: 'https://github.com/acme/skills/tree/main/skills/pdf-report', files: ['SKILL.md', 'scripts/make.py'] });
    await expect(importSkill(dir, 'https://github.com/acme/skills/tree/main/skills/empty', github({ 'skills/empty/readme.txt': 'x' }))).rejects.toThrow('SKILL.md가 없어요');
    await expect(importSkill(dir, 'https://example.com/x', github({}))).rejects.toThrow('GitHub 폴더 주소');
  });

  it('gives an agent a note with only its skills, and a deleted skill drops out', async () => {
    const dir = tmp();
    await saveSkill(dir, 'review', { name: '코드 리뷰', description: '체크리스트로 리뷰한다', allowedTools: [], body: 'x' });
    await saveSkill(dir, 'other', { name: '다른 것', description: '안 씀', allowedTools: [], body: 'x' });
    await saveAgent(dir, withDefaults({ name: 'Nova', connection: 'c', skills: ['review', 'gone'] }, 'nova'));
    const nova = (await resolve(dir, 'agent:nova')).agents.get('nova')!;
    expect(nova.skillBrief).toContain('- 코드 리뷰: 체크리스트로 리뷰한다 (/skills/review/SKILL.md)');
    expect(nova.skillBrief).not.toContain('다른 것');
    expect(skillBrief([])).toBe('');
    expect(existsSync(path.join(dir, 'agents', 'nova.json'))).toBe(true);
  });
});
