import { randomUUID } from 'node:crypto';
import { EventType } from '@ag-ui/core';
import type { Ev } from './events.ts';
import type { Agent, ChatFn, ChatMessage, Defs, Team, ToolDef } from './store.ts';

export type Emit = (e: Ev) => void;
export type Deps = {
  chat: ChatFn;
  toolDefs: (agent: Agent) => ToolDef[];
  runTool: (agent: Agent, name: string, args: string, signal: AbortSignal) => Promise<string>;
};
type Ctx = Deps & {
  emit: Emit;
  signal: AbortSignal;
  calls: { left: number }; // shared by every nested run
  defs: Defs;
  depth: number;
  maxDepth: number;
  subId?: string; // current subagentRunId; undefined for the run's main agent
  held: Set<string>; // agents this run already holds, so nested re-entry does not wait on itself
};
/** A tool that exists only inside a pattern (delegate), run with the calling agent's ctx. */
type Extra = { def: ToolDef; run: (args: Record<string, unknown>, toolCallId: string, ctx: Ctx) => Promise<string> };

export type AgUiMessage = { role: string; content?: unknown; toolCalls?: ChatMessage['tool_calls']; toolCallId?: string };

export class LimitError extends Error {}

// ponytail: non-text content parts are passed to the model as JSON text
const asText = (c: unknown) => (typeof c === 'string' ? c : c == null ? '' : JSON.stringify(c));
const say = (content: string): ChatMessage => ({ role: 'user', content });
const note = (content: string): ChatMessage => ({ role: 'system', content });

export function toChat(messages: AgUiMessage[]): ChatMessage[] {
  return messages.flatMap((m): ChatMessage[] => {
    switch (m.role) {
      case 'user':
        return [{ role: 'user', content: asText(m.content) }];
      case 'system':
      case 'developer':
        return [{ role: 'system', content: asText(m.content) }];
      case 'assistant':
        return [{ role: 'assistant', content: m.content == null ? null : asText(m.content), ...(m.toolCalls?.length ? { tool_calls: m.toolCalls } : {}) }];
      case 'tool':
        return [{ role: 'tool', content: asText(m.content), tool_call_id: m.toolCallId }];
      default:
        return [];
    }
  });
}

const locks = new Map<string, Promise<void>>();

/** One job at a time per agent: an agent is one character with one sandbox. */
export async function withAgentLock<T>(agentId: string, onWait: () => void, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(agentId);
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const chain = (prev ?? Promise.resolve()).then(() => mine);
  locks.set(agentId, chain);
  if (prev) {
    onWait();
    await prev;
  }
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(agentId) === chain) locks.delete(agentId);
  }
}

async function callModel(agent: Agent, messages: ChatMessage[], tools: ToolDef[], ctx: Ctx): Promise<ChatMessage> {
  ctx.signal.throwIfAborted();
  if (ctx.calls.left-- <= 0) throw new LimitError('maxCalls exceeded');
  const stream = await ctx.chat({ connection: agent.connection, model: agent.model, messages, tools }, ctx.signal);
  const messageId = randomUUID();
  let text = '';
  const calls: { id: string; name: string; args: string }[] = [];
  for await (const chunk of stream) {
    const d = chunk.choices[0]?.delta;
    if (!d) continue;
    if (d.content) {
      if (!text) ctx.emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
      text += d.content;
      ctx.emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: d.content });
    }
    for (const t of d.tool_calls ?? []) {
      const c = (calls[t.index] ??= { id: '', name: '', args: '' });
      if (t.id) c.id = t.id;
      c.name += t.function?.name ?? '';
      c.args += t.function?.arguments ?? '';
    }
  }
  if (text) ctx.emit({ type: EventType.TEXT_MESSAGE_END, messageId });
  const toolCalls = calls.filter(Boolean).map((c) => ({
    id: c.id || randomUUID(),
    type: 'function' as const,
    function: { name: c.name, arguments: c.args || '{}' },
  }));
  return { role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

async function runExtra(extra: Extra, rawArgs: string, toolCallId: string, ctx: Ctx): Promise<string> {
  try {
    return await extra.run(JSON.parse(rawArgs || '{}'), toolCallId, ctx);
  } catch (e) {
    if (ctx.signal.aborted || e instanceof LimitError) throw e;
    return `ERROR: ${(e as Error).message}`; // e.g. the member failed: the caller decides what to do
  }
}

async function runAgent(agent: Agent, input: ChatMessage[], ctx: Ctx, extra?: Extra): Promise<string> {
  const messages: ChatMessage[] = [{ role: 'system', content: agent.systemPrompt }, ...input];
  const tools = [...ctx.toolDefs(agent), ...(extra ? [extra.def] : [])];
  for (let step = 0; step < agent.maxSteps; step++) {
    const msg = await callModel(agent, messages, tools, ctx);
    messages.push(msg);
    if (!msg.tool_calls) return msg.content ?? '';
    const results = await Promise.all(msg.tool_calls.map(async (c) => {
      ctx.emit({ type: EventType.TOOL_CALL_START, toolCallId: c.id, toolCallName: c.function.name });
      ctx.emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: c.id, delta: c.function.arguments });
      ctx.emit({ type: EventType.TOOL_CALL_END, toolCallId: c.id });
      const content = extra && c.function.name === extra.def.function.name
        ? await runExtra(extra, c.function.arguments, c.id, ctx)
        : await ctx.runTool(agent, c.function.name, c.function.arguments, ctx.signal);
      ctx.emit({ type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId: c.id, content, role: 'tool' });
      return content;
    }));
    msg.tool_calls.forEach((c, i) => messages.push({ role: 'tool', tool_call_id: c.id, content: results[i] }));
  }
  throw new LimitError(`maxSteps (${agent.maxSteps}) exceeded`);
}

const teamOf = (name: string, ctx: Ctx): Team | undefined =>
  name.startsWith('team:') ? ctx.defs.teams.get(name.slice('team:'.length)) : undefined;

/** Every target has the same shape, so a team can be a member of another team. */
async function run(name: string, input: ChatMessage[], ctx: Ctx, extra?: Extra): Promise<string> {
  const team = teamOf(name, ctx);
  if (team) return patterns[team.pattern](team, input, ctx);
  const agent = ctx.defs.agents.get(name);
  if (!agent) throw new Error(`unknown agent: ${name}`);
  if (ctx.held.has(agent.id)) return runAgent(agent, input, ctx, extra);
  return withAgentLock(
    agent.id,
    () => ctx.emit({ type: EventType.CUSTOM, name: 'agentview.queued', value: { agentId: agent.id } }),
    async () => {
      ctx.held.add(agent.id);
      try {
        return await runAgent(agent, input, ctx, extra);
      } finally {
        ctx.held.delete(agent.id);
      }
    },
  );
}

/** Run a member as a subagent: its events carry its own subagentRunId; nested ones keep theirs. */
async function runSub(name: string, input: ChatMessage[], ctx: Ctx, opts: { parentToolCallId?: string; extra?: Extra } = {}): Promise<string> {
  if (ctx.depth >= ctx.maxDepth) throw new LimitError(`maxDepth (${ctx.maxDepth}) exceeded`);
  const subagentRunId = randomUUID();
  ctx.emit({
    type: EventType.SUBAGENT_STARTED, subagentRunId, name,
    ...(ctx.subId ? { parentSubagentRunId: ctx.subId } : {}),
    ...(opts.parentToolCallId ? { parentToolCallId: opts.parentToolCallId } : {}),
  });
  const child: Ctx = { ...ctx, depth: ctx.depth + 1, subId: subagentRunId, emit: (e) => ctx.emit({ subagentRunId, ...e }) };
  try {
    const result = await run(name, input, child, opts.extra);
    ctx.emit({ type: EventType.SUBAGENT_FINISHED, subagentRunId, result });
    return result;
  } catch (e) {
    const code = ctx.signal.aborted ? 'cancelled' : e instanceof LimitError ? 'limit' : 'error';
    ctx.emit({ type: EventType.SUBAGENT_ERROR, subagentRunId, message: (e as Error).message, code });
    throw e;
  }
}

/** How a member is introduced inside `team`: its team role when set, else its own role. */
const label = (m: string, ctx: Ctx, team?: Team) => {
  const sub = teamOf(m, ctx);
  if (sub) return `${sub.name} (팀)`;
  const a = ctx.defs.agents.get(m);
  const role = team?.roles?.[m]?.role || a?.role;
  return a ? `${a.name}${role ? ` (${role})` : ''}` : m;
};
/** The person's role and extra instructions in this team, as a system note added after its own prompt; nothing when unset. */
const brief = (team: Team, m: string): ChatMessage[] => {
  const r = team.roles?.[m];
  const lines = [r?.role && `이 팀(${team.name})에서 당신의 역할: ${r.role}`, r?.instructions && `이 팀(${team.name})에서의 추가 지시:\n${r.instructions}`].filter(Boolean);
  return lines.length ? [note(lines.join('\n\n'))] : [];
};
const folder = (team: Team) => note(`팀 공유 폴더: /team/${team.id} (팀원과 파일을 주고받을 때 사용)`);

/** The team's main is the run's main agent at the top level, and its own subagent when the team is nested. */
const runMain = (team: Team, input: ChatMessage[], ctx: Ctx, extra?: Extra) =>
  ctx.subId === undefined ? run(team.main, input, ctx, extra) : runSub(team.main, input, ctx, { extra });

async function supervisor(team: Team, input: ChatMessage[], ctx: Ctx): Promise<string> {
  const delegate: Extra = {
    def: {
      type: 'function',
      function: {
        name: 'delegate',
        description: `Give one team member a task and get their result back. Members:\n${team.members.map((m) => `- ${m}: ${label(m, ctx, team)}`).join('\n')}`,
        parameters: {
          type: 'object',
          properties: {
            member: { type: 'string', enum: team.members },
            task: { type: 'string', description: 'A self-contained task. The member does not see this conversation.' },
          },
          required: ['member', 'task'],
        },
      },
    },
    run: (args, toolCallId, at) => {
      const member = String(args.member);
      if (!team.members.includes(member)) throw new Error(`not a member of ${team.id}: ${member}`);
      return runSub(member, [folder(team), ...brief(team, member), say(String(args.task ?? ''))], at, { parentToolCallId: toolCallId });
    },
  };
  return runMain(team, [folder(team), ...brief(team, team.main), ...input], ctx, delegate);
}

async function parallel(team: Team, input: ChatMessage[], ctx: Ctx): Promise<string> {
  const results = await Promise.allSettled(team.members.map((m) =>
    runSub(m, [folder(team), ...brief(team, m), ...input, say(`당신의 역할: ${label(m, ctx, team)}. 위 요청에서 이 역할에 해당하는 부분을 맡아 처리하고 결과를 보고하세요.`)], ctx)));
  const fatal = results.find((r): r is PromiseRejectedResult => r.status === 'rejected' && (ctx.signal.aborted || r.reason instanceof LimitError));
  if (fatal) throw fatal.reason;
  const report = results.map((r, i) =>
    `[${label(team.members[i], ctx, team)}]\n${r.status === 'fulfilled' ? r.value : `(실패: ${(r.reason as Error).message})`}`).join('\n\n');
  return runMain(team, [folder(team), ...brief(team, team.main), ...input, say(`팀원 결과:\n\n${report}\n\n이 결과를 합쳐 최종 답을 쓰세요.`)], ctx);
}

async function debate(team: Team, input: ChatMessage[], ctx: Ctx): Promise<string> {
  const said: string[] = [];
  const rounds = team.limits.rounds;
  for (let round = 1; round <= rounds; round++) {
    for (const m of team.members) {
      ctx.emit({ type: EventType.CUSTOM, name: 'agentview.debate_turn', value: { round, speaker: m } });
      const r = await runSub(m, [...brief(team, m), ...input, say(
        `토론 ${round}/${rounds}라운드입니다. 지금까지의 발언:\n${said.join('\n\n') || '(아직 없음)'}\n\n` +
        `당신(${label(m, ctx, team)}) 차례입니다. 앞선 의견을 참고해 짧게 말하세요.`)], ctx);
      said.push(`[${label(m, ctx, team)}] ${r}`);
    }
  }
  return runMain(team, [...brief(team, team.main), ...input, say(`토론 기록:\n\n${said.join('\n\n')}\n\n사회자로서 결론을 정리하세요.`)], ctx);
}

const patterns: Record<Team['pattern'], (team: Team, input: ChatMessage[], ctx: Ctx) => Promise<string>> = { supervisor, parallel, debate };

const pub = ({ id, name, role, avatar }: Agent) => ({ id, name, role, avatar });

export async function startRun(
  input: { threadId: string; runId: string; messages: AgUiMessage[]; target: string; defs: Defs; maxCalls?: number },
  deps: Deps,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const { threadId, runId, target, defs } = input;
  const team = target.startsWith('team:') ? defs.teams.get(target.slice('team:'.length)) : undefined;
  const main = team ? team.main : target.slice('agent:'.length);
  emit({ type: EventType.RUN_STARTED, threadId, runId });
  emit({
    type: EventType.CUSTOM,
    name: 'agentview.run_info',
    value: {
      target, pattern: team?.pattern ?? 'single', main,
      agents: [...defs.agents.values()].map(pub),
      teams: [...defs.teams.values()].map(({ id, name, pattern, main, members, room }) => ({ id, name, pattern, main, members, room })),
    },
  });
  const ctx: Ctx = {
    ...deps, emit, signal, defs, depth: 0, held: new Set(),
    calls: { left: input.maxCalls ?? team?.limits.maxCalls ?? 20 },
    maxDepth: team?.limits.maxDepth ?? 3,
  };
  try {
    const result = await run(team ? target : main, toChat(input.messages), ctx);
    emit({ type: EventType.RUN_FINISHED, threadId, runId, result });
  } catch (e) {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
    const code = signal.aborted ? (timedOut ? 'timeout' : 'cancelled') : e instanceof LimitError ? 'limit' : 'error';
    emit({ type: EventType.RUN_ERROR, message: signal.aborted ? code : (e as Error).message, code });
  }
}
