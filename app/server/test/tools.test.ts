import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Agent } from '../src/store.ts';
import { runTool, toolDefs, type ExecFn } from '../src/tools.ts';

const agent: Agent = {
  id: 'nova', name: 'Nova', role: '', connection: 'c', model: 'm', systemPrompt: '', maxSteps: 5,
  tools: ['sandbox_write_file', 'sandbox_read_file', 'sandbox_run'],
  sandbox: { image: 'x', network: false }, avatar: { model: 'default.glb', color: '#000000' },
};
const sig = () => new AbortController().signal;
const neverExec: ExecFn = async () => { throw new Error('exec should not be called'); };
const env = () => ({ dataDir: mkdtempSync(path.join(tmpdir(), 'av-tools-')), exec: neverExec });

describe('tools', () => {
  it('offers only the tools the agent is allowed to use', () => {
    expect(toolDefs(agent).map((d) => d.function.name)).toEqual(['sandbox_read_file', 'sandbox_write_file', 'sandbox_run']);
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
