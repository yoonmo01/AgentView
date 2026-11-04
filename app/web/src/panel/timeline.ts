import type { AgUiEvent } from '../office/state.ts';

export type Item =
  | { kind: 'run'; at: number; text: string; error?: boolean }
  | { kind: 'text'; id: string; at: number; text: string }
  | { kind: 'tool'; id: string; at: number; name: string; args: string; result?: string; ms?: number };

/** Pure: one run's events that belong to `agentId`, as timeline items in order. Run-level events show for everyone. */
export function timeline(events: AgUiEvent[], agentId: string): Item[] {
  let main = '';
  const subs: Record<string, string> = {};
  const items: Item[] = [];
  const open = new Map<string, Item>(); // text messages and tool calls by id
  for (const e of events) {
    if (e.type === 'CUSTOM' && e.name === 'agentview.run_info') main = e.value.main;
    if (e.type === 'SUBAGENT_STARTED') subs[e.subagentRunId] = e.name;
    const mine = e.subagentRunId ? subs[e.subagentRunId] === agentId : main === agentId;
    const at: number = e.timestamp ?? 0;
    const push = (item: Item, id?: string) => { items.push(item); if (id) open.set(id, item); };
    switch (e.type) {
      case 'RUN_STARTED': push({ kind: 'run', at, text: '실행 시작' }); break;
      case 'RUN_FINISHED': push({ kind: 'run', at, text: '실행 완료' }); break;
      case 'RUN_ERROR': push({ kind: 'run', at, text: `실행 중단: ${e.message}`, error: true }); break;
      case 'CUSTOM':
        if (e.name === 'agentview.queued' && e.value.agentId === agentId) push({ kind: 'run', at, text: '다른 실행의 작업이 끝나길 기다리는 중' });
        break;
      case 'SUBAGENT_STARTED': if (mine) push({ kind: 'run', at, text: '맡은 작업 시작' }); break;
      case 'SUBAGENT_FINISHED': if (mine) push({ kind: 'run', at, text: '맡은 작업 완료' }); break;
      case 'SUBAGENT_ERROR': if (mine) push({ kind: 'run', at, text: `맡은 작업 실패: ${e.message ?? ''}`, error: true }); break;
      case 'TEXT_MESSAGE_START': if (mine) push({ kind: 'text', id: e.messageId, at, text: '' }, e.messageId); break;
      case 'TOOL_CALL_START': if (mine) push({ kind: 'tool', id: e.toolCallId, at, name: e.toolCallName, args: '' }, e.toolCallId); break;
      case 'TEXT_MESSAGE_CONTENT': {
        const it = open.get(e.messageId);
        if (it?.kind === 'text') it.text += e.delta;
        break;
      }
      case 'TOOL_CALL_ARGS': {
        const it = open.get(e.toolCallId);
        if (it?.kind === 'tool') it.args += e.delta;
        break;
      }
      case 'TOOL_CALL_RESULT': {
        const it = open.get(e.toolCallId);
        if (it?.kind === 'tool') { it.result = e.content; it.ms = at - it.at; }
        break;
      }
    }
  }
  return items;
}

/** Files this agent wrote during the run, from its sandbox_write_file calls. */
export function writtenFiles(items: Item[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    if (it.kind !== 'tool' || it.name !== 'sandbox_write_file') continue;
    try { out.add(String(JSON.parse(it.args).path).replace(/^\/work\//, '')); } catch { /* unfinished args */ }
  }
  return out;
}
