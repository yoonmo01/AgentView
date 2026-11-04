import { describe, expect, it } from 'vitest';
import type { Ev } from '../src/events.ts';
import { startRun, toChat, type Deps } from '../src/runner.ts';
import type { Agent, ChatChunk, ChatFn, ChatRequest } from '../src/store.ts';

const agent: Agent = {
  id: 'nova', name: 'Nova', role: 'coder', connection: 'c', model: 'm', systemPrompt: 'be brief', maxSteps: 5,
  tools: ['sandbox_run'], sandbox: { image: 'x', network: false }, avatar: { model: 'default.glb', color: '#000000' },
};
const sig = () => new AbortController().signal;
const text = (s: string): ChatChunk[] => [{ choices: [{ delta: { content: s } }] }];
const call = (id: string, name: string, args: object): ChatChunk[] => [
  { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args).slice(0, 5) } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(5) } }] } }] },
];
function script(turns: ChatChunk[][], seen: ChatRequest[] = []): ChatFn {
  let i = 0;
  return async (req) => {
    seen.push(structuredClone(req));
    const chunks = turns[i++] ?? [];
    return (async function* () { yield* chunks; })();
  };
}
const deps = (chat: ChatFn, runTool: Deps['runTool'] = async () => 'ok'): Deps => ({ chat, runTool, toolDefs: () => [] });
const run = async (chat: ChatFn, opts: { runTool?: Deps['runTool']; maxCalls?: number; signal?: AbortSignal; runId?: string } = {}) => {
  const evs: Ev[] = [];
  await startRun({ threadId: 't', runId: opts.runId ?? 'r', messages: [{ role: 'user', content: 'hi' }], agent, maxCalls: opts.maxCalls },
    deps(chat, opts.runTool), (e) => evs.push(e), opts.signal ?? sig());
  return evs;
};

describe('runner', () => {
  it('streams a text answer as AG-UI events', async () => {
    const evs = await run(script([text('hello')]));
    expect(evs.map((e) => e.type)).toEqual(['RUN_STARTED', 'CUSTOM', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
    expect(evs[1]).toMatchObject({ name: 'agentview.run_info', value: { target: 'agent:nova', main: 'nova' } });
    expect(evs.at(-1)).toMatchObject({ threadId: 't', runId: 'r', result: 'hello' });
  });

  it('runs a streamed tool call, feeds the result back, then answers', async () => {
    const seen: ChatRequest[] = [];
    const toolArgs: string[] = [];
    const evs = await run(script([call('c1', 'sandbox_run', { command: 'ls' }), text('done')], seen), {
      runTool: async (_a, _n, args) => { toolArgs.push(args); return 'file.txt'; },
    });
    expect(evs.map((e) => e.type)).toEqual([
      'RUN_STARTED', 'CUSTOM', 'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT',
      'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED',
    ]);
    expect(evs[2]).toMatchObject({ toolCallId: 'c1', toolCallName: 'sandbox_run' });
    expect(evs[5]).toMatchObject({ toolCallId: 'c1', content: 'file.txt', role: 'tool' });
    expect(toolArgs).toEqual(['{"command":"ls"}']);
    expect(seen[0].messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(seen[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'file.txt' });
  });

  it('stops with a limit error when maxCalls is used up', async () => {
    const evs = await run(script([call('c1', 'sandbox_run', { command: 'ls' }), text('never')]), { maxCalls: 1 });
    expect(evs.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'limit' });
  });

  it('reports cancellation', async () => {
    const ac = new AbortController();
    const hang: ChatFn = (_req, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const pending = run(hang, { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    expect((await pending).at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'cancelled', message: 'cancelled' });
  });

  it('runs one job at a time per agent and reports the wait', async () => {
    const order: string[] = [];
    const slow: ChatFn = async () => (async function* () {
      order.push('start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('end');
      yield { choices: [{ delta: { content: 'ok' } }] };
    })();
    const [a, b] = await Promise.all([run(slow, { runId: 'a' }), run(slow, { runId: 'b' })]);
    expect(order).toEqual(['start', 'end', 'start', 'end']);
    expect(a.some((e) => e.name === 'agentview.queued')).toBe(false);
    expect(b.some((e) => e.name === 'agentview.queued')).toBe(true);
  });

  it('converts AG-UI messages to chat messages', () => {
    expect(toChat([
      { role: 'developer', content: 'rules' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, toolCalls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
      { role: 'tool', content: 'r', toolCallId: 'c1' },
      { role: 'activity', content: 'ignored' },
    ])).toEqual([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
      { role: 'tool', content: 'r', tool_call_id: 'c1' },
    ]);
  });
});
