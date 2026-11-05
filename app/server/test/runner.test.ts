import { describe, expect, it } from 'vitest';
import type { Ev } from '../src/events.ts';
import { startRun, toChat, type Deps } from '../src/runner.ts';
import { teamWithDefaults, type Agent, type ChatChunk, type ChatFn, type ChatRequest, type Defs, type Team } from '../src/store.ts';

const make = (id: string, systemPrompt = id): Agent => ({
  id, name: id.toUpperCase(), role: `${id} role`, connection: 'c', model: 'm', systemPrompt, maxSteps: 5,
  tools: ['sandbox_run'], sandbox: { image: 'x', network: false }, avatar: { model: 'default.glb', color: '#000000' },
});
const agent = make('nova', 'be brief');
const defsOf = (agents: Agent[], teams: Team[] = []): Defs =>
  ({ agents: new Map(agents.map((a) => [a.id, a])), teams: new Map(teams.map((t) => [t.id, t])) });
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
  await startRun({ threadId: 't', runId: opts.runId ?? 'r', messages: [{ role: 'user', content: 'hi' }], target: 'agent:nova', defs: defsOf([agent]), maxCalls: opts.maxCalls },
    deps(chat, opts.runTool), (e) => evs.push(e), opts.signal ?? sig());
  return evs;
};

/** Fake model that answers per agent (keyed by system prompt), so concurrent members stay deterministic. */
function byAgent(turns: Record<string, ChatChunk[][]>, seen: ChatRequest[] = []): ChatFn {
  return async (req) => {
    seen.push(structuredClone(req));
    const who = String(req.messages[0].content);
    const chunks = turns[who]?.shift() ?? text(`${who}: ok`);
    return (async function* () { yield* chunks; })();
  };
}
const team = (id: string, pattern: Team['pattern'], main: string, members: string[], limits: Partial<Team['limits']> = {}) =>
  teamWithDefaults({ name: id, pattern, main, members, limits: limits as Team['limits'] }, id);
const runTeam = async (chat: ChatFn, teams: Team[], target = teams[0].id) => {
  const evs: Ev[] = [];
  await startRun({ threadId: 't', runId: `r-${target}`, messages: [{ role: 'user', content: 'topic' }], target: `team:${target}`,
    defs: defsOf(['atlas', 'nova', 'milo'].map((id) => make(id)), teams) }, deps(chat), (e) => evs.push(e), sig());
  return evs;
};
const subs = (evs: Ev[]) => evs.filter((e) => e.type === 'SUBAGENT_STARTED');

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

  it('leaves the line when cancelled while waiting', async () => {
    const slow: ChatFn = async () => (async function* () {
      await new Promise((r) => setTimeout(r, 150));
      yield { choices: [{ delta: { content: 'ok' } }] };
    })();
    const ac = new AbortController();
    const first = run(slow, { runId: 'a' });
    const t0 = Date.now();
    const second = run(slow, { runId: 'b', signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    expect((await second).at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'cancelled' });
    expect(Date.now() - t0).toBeLessThan(100); // did not wait for the first job
    expect((await first).at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
    expect((await run(script([text('next')]))).at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'next' }); // line still moves
  });

  it('two tasks handed to the same member at once run one after the other', async () => {
    const order: string[] = [];
    const chat: ChatFn = async (req) => {
      const who = String(req.messages[0].content);
      const last = req.messages.at(-1)!;
      return (async function* () {
        if (who === 'atlas' && last.role !== 'tool' && req.messages.every((m) => m.role !== 'tool')) {
          yield { choices: [{ delta: { tool_calls: [
            { index: 0, id: 'd1', function: { name: 'delegate', arguments: '{"member":"nova","task":"one"}' } },
            { index: 1, id: 'd2', function: { name: 'delegate', arguments: '{"member":"nova","task":"two"}' } },
          ] } }] };
          return;
        }
        if (who === 'nova') {
          order.push(`start ${last.content}`);
          await new Promise((r) => setTimeout(r, 20));
          order.push(`end ${last.content}`);
        }
        yield { choices: [{ delta: { content: `${who}: ok` } }] };
      })();
    };
    const evs = await runTeam(chat, [team('dev', 'supervisor', 'atlas', ['nova', 'milo'])]);
    expect(order).toEqual(['start one', 'end one', 'start two', 'end two']);
    expect(evs.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
  });

  it('two teams asking each other\'s main for help both finish: waiting on a member frees the agent', async () => {
    const chat: ChatFn = async (req) => {
      const who = String(req.messages[0].content);
      const last = req.messages.at(-1)!;
      if (last.role !== 'tool' && last.content !== 'help') await new Promise((r) => setTimeout(r, 20)); // both teams start first
      const chunks = last.role === 'tool' ? text(`${who} done`) : last.content === 'help' ? text(`${who} helped`)
        : call(`d-${who}`, 'delegate', { member: who === 'atlas' ? 'nova' : 'atlas', task: 'help' });
      return (async function* () { yield* chunks; })();
    };
    const teams = [team('a', 'supervisor', 'atlas', ['nova']), team('b', 'supervisor', 'nova', ['atlas'])];
    const [a, b] = await Promise.all([runTeam(chat, teams, 'a'), runTeam(chat, teams, 'b')]);
    expect(a.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'atlas done' });
    expect(b.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'nova done' });
  });

  it('supervisor: the main delegates to a member as a subagent and gets the result back', async () => {
    const seen: ChatRequest[] = [];
    const evs = await runTeam(byAgent({ atlas: [call('d1', 'delegate', { member: 'nova', task: 'write it' }), text('all done')] }, seen),
      [team('dev', 'supervisor', 'atlas', ['nova', 'milo'])]);
    expect(evs[1]).toMatchObject({ name: 'agentview.run_info', value: { target: 'team:dev', pattern: 'supervisor', main: 'atlas' } });
    const [started] = subs(evs);
    expect(started).toMatchObject({ name: 'nova', parentToolCallId: 'd1' });
    const id = started.subagentRunId;
    expect(evs.filter((e) => e.type === 'TEXT_MESSAGE_START').map((e) => e.subagentRunId)).toEqual([id, undefined]);
    expect(evs.find((e) => e.type === 'SUBAGENT_FINISHED')).toMatchObject({ subagentRunId: id, result: 'nova: ok' });
    expect(evs.find((e) => e.type === 'TOOL_CALL_RESULT')).toMatchObject({ toolCallId: 'd1', content: 'nova: ok' });
    expect(evs.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'all done' });
    const delegate = seen[0].tools.find((t) => t.function.name === 'delegate')!;
    expect(delegate.function.parameters).toMatchObject({ properties: { member: { enum: ['nova', 'milo'] } } });
    expect(seen[1].messages.at(-1)).toEqual({ role: 'user', content: 'write it' }); // member starts fresh with the task
  });

  it('team roles: members are introduced by their team role and get the team instructions', async () => {
    const seen: ChatRequest[] = [];
    const dev = { ...team('dev', 'supervisor', 'atlas', ['nova', 'milo']), roles: { nova: { role: '백엔드', instructions: '테스트는 쓰지 마' } } };
    await runTeam(byAgent({ atlas: [call('d1', 'delegate', { member: 'nova', task: 'write it' }), text('done')] }, seen), [dev]);
    expect(seen[0].tools.find((t) => t.function.name === 'delegate')!.function.description).toContain('(백엔드)');
    const sys = seen[1].messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    expect(sys).toContain('역할: 백엔드');
    expect(sys).toContain('테스트는 쓰지 마');
    expect(seen[0].messages.some((m) => String(m.content).includes('테스트는 쓰지 마'))).toBe(false); // only nova gets it
  });

  it('parallel: every member runs, then the main merges their results', async () => {
    const seen: ChatRequest[] = [];
    const evs = await runTeam(byAgent({}, seen), [team('pair', 'parallel', 'atlas', ['nova', 'milo'])]);
    expect(subs(evs).map((e) => e.name).sort()).toEqual(['milo', 'nova']);
    const merge = seen.at(-1)!;
    expect(merge.messages[0].content).toBe('atlas');
    expect(merge.messages.at(-1)!.content).toContain('nova: ok');
    expect(merge.messages.at(-1)!.content).toContain('milo: ok');
    expect(evs.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'atlas: ok' });
  });

  it('debate: members speak in order for each round, then the main concludes', async () => {
    const seen: ChatRequest[] = [];
    const evs = await runTeam(byAgent({}, seen), [team('talk', 'debate', 'atlas', ['nova', 'milo'], { rounds: 2 })]);
    expect(evs.filter((e) => e.name === 'agentview.debate_turn').map((e) => e.value))
      .toEqual([{ round: 1, speaker: 'nova' }, { round: 1, speaker: 'milo' }, { round: 2, speaker: 'nova' }, { round: 2, speaker: 'milo' }]);
    expect(seen[1].messages.at(-1)!.content).toContain('[NOVA (nova role)] nova: ok'); // milo hears nova
    expect(seen.at(-1)!.messages.at(-1)!.content).toContain('사회자');
  });

  it('nested team: the inner main runs as its own subagent and the same agent on both levels takes turns', async () => {
    const evs = await runTeam(byAgent({}), [team('outer', 'parallel', 'atlas', ['team:inner']), team('inner', 'parallel', 'atlas', ['nova'])]);
    const [inner, ...rest] = subs(evs);
    expect(inner).toMatchObject({ name: 'team:inner' });
    expect(rest.map((e) => [e.name, e.parentSubagentRunId])).toEqual([['nova', inner.subagentRunId], ['atlas', inner.subagentRunId]]);
    expect(evs.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
  });

  it('stops with a limit error past maxDepth', async () => {
    const evs = await runTeam(byAgent({}), [team('outer', 'parallel', 'atlas', ['team:inner'], { maxDepth: 1 }), team('inner', 'parallel', 'milo', ['nova'])]);
    expect(evs.some((e) => e.type === 'SUBAGENT_ERROR' && e.code === 'limit')).toBe(true);
    expect(evs.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'limit' });
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
