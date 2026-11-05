import { describe, expect, it } from 'vitest';
import type { Agent } from '../src/store.ts';
import { containerPath, runTool, toolDefs, type ExecFn } from '../src/tools.ts';
import { memFiles } from './memFiles.ts';

const agent: Agent = {
  id: 'nova', name: 'Nova', role: '', connection: 'c', model: 'm', systemPrompt: '', maxSteps: 5,
  tools: ['sandbox_write_file', 'sandbox_read_file', 'sandbox_run'],
  sandbox: { image: 'x', network: false }, avatar: { model: 'default.glb', color: '#000000' },
};
const sig = () => new AbortController().signal;
const neverExec: ExecFn = async () => { throw new Error('exec should not be called'); };
const env = () => ({ files: memFiles(), exec: neverExec });

describe('tools', () => {
  it('offers only the tools the agent is allowed to use', () => {
    expect(toolDefs(agent).map((d) => d.function.name)).toEqual(['sandbox_read_file', 'sandbox_write_file', 'sandbox_run']);
  });

  it('edits part of a file, refusing missing or ambiguous text', async () => {
    const e = env();
    const coder = { ...agent, tools: ['sandbox_write_file', 'sandbox_read_file', 'sandbox_edit_file'] };
    await runTool(coder, 'sandbox_write_file', JSON.stringify({ path: 'a.py', content: 'x = 1\ny = 1\n' }), sig(), e);
    const edit = (args: object) => runTool(coder, 'sandbox_edit_file', JSON.stringify({ path: 'a.py', ...args }), sig(), e);
    expect(await edit({ old_text: 'x = 1', new_text: 'x = 2' })).toBe('edited a.py (1 place)');
    expect(await edit({ old_text: 'zzz', new_text: '' })).toBe('ERROR: old_text not found in the file');
    expect(await edit({ old_text: ' = ', new_text: '=' })).toMatch(/appears 2 times/);
    expect(await edit({ old_text: ' = ', new_text: '=', replace_all: true })).toBe('edited a.py (2 places)');
    expect(await runTool(coder, 'sandbox_read_file', '{"path":"a.py"}', sig(), e)).toBe('x=2\ny=1\n');
  });

  it('searches files and reads web pages only with internet', async () => {
    const e = env();
    const a = { ...agent, tools: ['sandbox_write_file', 'sandbox_search', 'web_fetch'] };
    await runTool(a, 'sandbox_write_file', JSON.stringify({ path: 'src/m.py', content: 'def add():\n  pass\n' }), sig(), e);
    expect(await runTool(a, 'sandbox_search', '{"pattern":"def \\\\w+"}', sig(), e)).toBe('src/m.py:1:def add():');
    expect(await runTool(a, 'sandbox_search', '{"pattern":"nothing"}', sig(), e)).toBe('(no matches)');
    expect(await runTool(a, 'web_fetch', '{"url":"https://example.com"}', sig(), e)).toMatch(/no internet access/);
    const online = { ...a, sandbox: { ...a.sandbox, network: true } };
    expect(await runTool(online, 'web_fetch', '{"url":"https://example.com"}', sig(), e)).toBe('page at https://example.com');
    expect(await runTool(online, 'web_fetch', '{"url":"file:///etc/passwd"}', sig(), e)).toMatch(/must start with http/);
  });

  it('writes then reads a file in the workspace', async () => {
    const e = env();
    expect(await runTool(agent, 'sandbox_write_file', JSON.stringify({ path: 'a.txt', content: 'x' }), sig(), e)).toBe('wrote a.txt');
    expect(await runTool(agent, 'sandbox_read_file', '{"path":"/work/a.txt"}', sig(), e)).toBe('x');
  });

  it('shares /team/<id> files between members and refuses other teams', async () => {
    const e = env();
    const writer = { ...agent, teams: ['dev'] };
    const reader = { ...agent, id: 'milo', teams: ['dev'] };
    await runTool(writer, 'sandbox_write_file', '{"path":"/team/dev/plan.md","content":"p"}', sig(), e);
    expect(await runTool(reader, 'sandbox_read_file', '{"path":"/team/dev/plan.md"}', sig(), e)).toBe('p');
    expect(await runTool(reader, 'sandbox_read_file', '{"path":"/team/ops/x"}', sig(), e)).toBe('ERROR: not a member of team ops');
    expect(await runTool(agent, 'sandbox_read_file', '{"path":"/team/dev/plan.md"}', sig(), e)).toMatch('not a member');
  });

  it('keeps paths to /work and the own team folders', () => {
    const dev = { ...agent, teams: ['dev'] };
    expect(containerPath(dev, 'src/a.py')).toBe('/work/src/a.py');
    expect(containerPath(dev, '/work/')).toBe('/work');
    expect(containerPath(dev, '/team/dev/plan.md')).toBe('/team/dev/plan.md');
    expect(() => containerPath(dev, '/work/../etc/passwd')).toThrow('path outside workspace');
    expect(() => containerPath(dev, '../../x')).toThrow('path outside workspace');
    expect(() => containerPath(dev, '/team/ops/x')).toThrow('not a member of team ops');
  });

  it('returns failures as ERROR text for the model', async () => {
    const e = env();
    expect(await runTool(agent, 'sandbox_list_files', '{}', sig(), e)).toMatch(/^ERROR: tool not allowed/);
    expect(await runTool(agent, 'sandbox_read_file', '{"path":"../x"}', sig(), e)).toMatch(/^ERROR: path outside workspace/);
    expect(await runTool(agent, 'sandbox_run', 'not json', sig(), e)).toMatch(/^ERROR:/);
  });

  it('passes commands to the sandbox and clamps the timeout', async () => {
    const calls: unknown[] = [];
    const exec: ExecFn = async (_a, command, timeoutSec) => {
      calls.push([command, timeoutSec]);
      return { stdout: 'hi\n', stderr: '', exitCode: 0 };
    };
    const out = await runTool(agent, 'sandbox_run', JSON.stringify({ command: 'echo hi', timeoutSec: 9999 }), sig(), { ...env(), exec });
    expect(out).toContain('exit code: 0');
    expect(out).toContain('hi');
    expect(calls).toEqual([['echo hi', 600]]);
  });

  it('rethrows when the run is cancelled', async () => {
    const ac = new AbortController();
    const exec: ExecFn = async () => { ac.abort(); throw new Error('aborted'); };
    await expect(runTool(agent, 'sandbox_run', '{"command":"x"}', ac.signal, { ...env(), exec })).rejects.toThrow('aborted');
  });
});
