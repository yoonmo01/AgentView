export type Status = 'idle' | 'thinking' | 'typing' | 'reading' | 'queued' | 'error' | 'done';
export type AgentView = { status: Status; tool?: string; runId: string; since: number };
export type OfficeState = {
  agents: Record<string, AgentView>;
  runs: Record<string, { main: string; subs: Record<string, string> }>;
  seen: Record<string, number>;
};
// AG-UI payload fields vary by event type
export type AgUiEvent = { type: string; [key: string]: any };

export const initial: OfficeState = { agents: {}, runs: {}, seen: {} };
export const LABEL: Record<Status, string> = {
  idle: '대기', thinking: '생각 중', typing: '작업 중', reading: '읽는 중', queued: '대기열', error: '오류', done: '완료',
};

const WRITE_TOOLS = new Set(['sandbox_write_file', 'sandbox_run']);
const SETTLE_MS = 5_000;

/** Status to draw now: done/error fall back to idle after a few seconds. */
export function displayStatus(v: AgentView | undefined, now: number): Status {
  if (!v) return 'idle';
  if ((v.status === 'done' || v.status === 'error') && now - v.since > SETTLE_MS) return 'idle';
  return v.status;
}

function nextStatus(e: AgUiEvent): Pick<AgentView, 'status' | 'tool'> | null {
  switch (e.type) {
    case 'CUSTOM':
      return e.name === 'agentview.run_info' ? { status: 'thinking' } : e.name === 'agentview.queued' ? { status: 'queued' } : null;
    case 'SUBAGENT_STARTED':
    case 'TEXT_MESSAGE_START':
    case 'TOOL_CALL_RESULT':
      return { status: 'thinking' };
    case 'TOOL_CALL_START':
      return { status: WRITE_TOOLS.has(e.toolCallName) ? 'typing' : 'reading', tool: e.toolCallName };
    case 'SUBAGENT_FINISHED':
      return { status: 'done' };
    case 'SUBAGENT_ERROR':
      return { status: 'error' };
    default:
      return null;
  }
}

/** Pure: fold one AG-UI event of a run into the office state. Same or older seq is ignored. */
export function apply(s: OfficeState, runId: string, seq: number, e: AgUiEvent, now: number): OfficeState {
  if (seq <= (s.seen[runId] ?? -1)) return s;
  const seen = { ...s.seen, [runId]: seq };
  let runs = s.runs;
  if (e.type === 'CUSTOM' && e.name === 'agentview.run_info') runs = { ...runs, [runId]: { main: e.value.main, subs: {} } };
  const run = runs[runId];
  if (e.type === 'SUBAGENT_STARTED' && run) runs = { ...runs, [runId]: { ...run, subs: { ...run.subs, [e.subagentRunId]: e.name } } };

  if (e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR') {
    const status: Status = e.type === 'RUN_FINISHED' ? 'done' : 'error';
    const agents = { ...s.agents };
    for (const [id, v] of Object.entries(agents)) {
      if (v.runId === runId && v.status !== 'done' && v.status !== 'error') agents[id] = { status, runId, since: now };
    }
    return { agents, runs, seen };
  }

  const agentId: string | undefined =
    e.type === 'CUSTOM' && e.name === 'agentview.queued' ? e.value.agentId
    : e.subagentRunId ? runs[runId]?.subs[e.subagentRunId]
    : runs[runId]?.main;
  const next = agentId ? nextStatus(e) : null;
  if (!agentId || !next) return { ...s, runs, seen };
  return { agents: { ...s.agents, [agentId]: { ...next, runId, since: now } }, runs, seen };
}
