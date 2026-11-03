import { randomUUID } from 'node:crypto';
import { EventType } from '@ag-ui/core';
import type { Ev } from './events.ts';
import type { Agent, ChatFn, ChatMessage, ToolDef } from './store.ts';

export type Emit = (e: Ev) => void;
export type Deps = {
  chat: ChatFn;
  toolDefs: (agent: Agent) => ToolDef[];
  runTool: (agent: Agent, name: string, args: string, signal: AbortSignal) => Promise<string>;
};
type Ctx = Deps & { emit: Emit; signal: AbortSignal; calls: { left: number } };

export type AgUiMessage = { role: string; content?: unknown; toolCalls?: ChatMessage['tool_calls']; toolCallId?: string };

class LimitError extends Error {}

// ponytail: non-text content parts are passed to the model as JSON text
const asText = (c: unknown) => (typeof c === 'string' ? c : c == null ? '' : JSON.stringify(c));

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

async function callModel(agent: Agent, messages: ChatMessage[], ctx: Ctx): Promise<ChatMessage> {
  ctx.signal.throwIfAborted();
  if (ctx.calls.left-- <= 0) throw new LimitError('maxCalls exceeded');
  const stream = await ctx.chat({ connection: agent.connection, model: agent.model, messages, tools: ctx.toolDefs(agent) }, ctx.signal);
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

async function runAgent(agent: Agent, input: ChatMessage[], ctx: Ctx): Promise<string> {
  const messages: ChatMessage[] = [{ role: 'system', content: agent.systemPrompt }, ...input];
  for (let step = 0; step < agent.maxSteps; step++) {
    const msg = await callModel(agent, messages, ctx);
    messages.push(msg);
    if (!msg.tool_calls) return msg.content ?? '';
    const results = await Promise.all(msg.tool_calls.map(async (c) => {
      ctx.emit({ type: EventType.TOOL_CALL_START, toolCallId: c.id, toolCallName: c.function.name });
      ctx.emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: c.id, delta: c.function.arguments });
      ctx.emit({ type: EventType.TOOL_CALL_END, toolCallId: c.id });
      const content = await ctx.runTool(agent, c.function.name, c.function.arguments, ctx.signal);
      ctx.emit({ type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId: c.id, content, role: 'tool' });
      return content;
    }));
    msg.tool_calls.forEach((c, i) => messages.push({ role: 'tool', tool_call_id: c.id, content: results[i] }));
  }
  throw new LimitError(`maxSteps (${agent.maxSteps}) exceeded`);
}

export async function startRun(
  input: { threadId: string; runId: string; messages: AgUiMessage[]; agent: Agent; maxCalls?: number },
  deps: Deps,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const { threadId, runId, agent } = input;
  emit({ type: EventType.RUN_STARTED, threadId, runId });
  emit({
    type: EventType.CUSTOM,
    name: 'agentview.run_info',
    value: { target: `agent:${agent.id}`, main: agent.id, agents: [{ id: agent.id, name: agent.name, role: agent.role, avatar: agent.avatar }] },
  });
  const ctx: Ctx = { ...deps, emit, signal, calls: { left: input.maxCalls ?? 20 } };
  try {
    const result = await withAgentLock(
      agent.id,
      () => emit({ type: EventType.CUSTOM, name: 'agentview.queued', value: { agentId: agent.id } }),
      () => runAgent(agent, toChat(input.messages), ctx),
    );
    emit({ type: EventType.RUN_FINISHED, threadId, runId, result });
  } catch (e) {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
    const code = signal.aborted ? (timedOut ? 'timeout' : 'cancelled') : e instanceof LimitError ? 'limit' : 'error';
    emit({ type: EventType.RUN_ERROR, message: signal.aborted ? code : (e as Error).message, code });
  }
}
