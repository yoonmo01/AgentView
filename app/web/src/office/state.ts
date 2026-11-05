export type Status = 'idle' | 'thinking' | 'typing' | 'reading' | 'queued' | 'error' | 'done';
/** `say` is what the agent is visibly doing right now: the tail of its streamed text, or its current action. */
export type AgentView = { status: Status; tool?: string; runId: string; since: number; say?: string };
/** `target` is what the run was asked of (`agent:x` or `team:x`); `teams` are every team taking part. */
export type RunView = { main: string; pattern: string; agents: string[]; live: boolean; subs: Record<string, string>; target?: string; teams?: string[] };
export type OfficeState = {
  agents: Record<string, AgentView>;
  runs: Record<string, RunView>;
  /** Active delegations to draw as lines, keyed "runId/subagentRunId". */
  links: Record<string, { from: string; to: string }>;
  seen: Record<string, number>;
};
// AG-UI payload fields vary by event type
export type AgUiEvent = { type: string; [key: string]: any };

export const initial: OfficeState = { agents: {}, runs: {}, links: {}, seen: {} };
/** What people see: thinking, writing and reading are all "작업 중"; the bubble says what exactly. */
export const LABEL: Record<Status, string> = {
  idle: '대기 중', thinking: '작업 중', typing: '작업 중', reading: '작업 중', queued: '대기열', error: '오류', done: '완료',
};
/** One color per visible status (floor disc, chips); the text label always goes with it. */
export const COLOR: Record<Status, string> = {
  idle: '#2f9a62', thinking: '#e8862a', typing: '#e8862a', reading: '#e8862a', queued: '#d9a400', error: '#d64545', done: '#3b7ddd',
};

const SAY_MAX = 70;
const base = (p: unknown) => String(p ?? '').replace(/^\/work\//, '').split('/').pop() || String(p ?? '');
/**
 * Human-readable action for a tool call, from its name and (possibly partial) JSON arguments.
 * `done` gives the past-tense form used in a session's activity list.
 */
export function describeTool(name: string, rawArgs: string, done = false): string {
  let a: Record<string, unknown> = {};
  try { a = JSON.parse(rawArgs || '{}'); } catch { /* arguments still streaming */ }
  const file = a.path ? base(a.path) : '파일';
  switch (name) {
    case 'sandbox_write_file': return done ? `${file} 작성` : `${file} 쓰는 중`;
    case 'sandbox_read_file': return done ? `${file} 읽음` : `${file} 읽는 중`;
    case 'sandbox_list_files': return done ? '파일 목록 확인' : '파일 둘러보는 중';
    case 'sandbox_run': return a.command ? `실행: ${String(a.command).slice(0, 50)}` : done ? '명령 실행' : '명령 실행 중';
    case 'delegate': return a.member ? (done ? `${String(a.member)}에게 맡김` : `${String(a.member)}에게 맡기는 중`) : '일 나누는 중';
    default: {
      const tool = name.startsWith('mcp__') ? `${name.split('__').pop()} 도구` : name;
      return done ? `${tool} 사용` : `${tool} 쓰는 중`;
    }
  }
}

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
      return e.name === 'agentview.run_info' ? { status: 'thinking' } : e.name === 'agentview.queued' ? { status: 'queued' } : e.name === 'agentview.resumed' ? { status: 'reading' } : null;
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
const isTeam = (name: string) => name.startsWith('team:');

export function apply(s: OfficeState, runId: string, seq: number, e: AgUiEvent, now: number): OfficeState {
  if (seq <= (s.seen[runId] ?? -1)) return s;
  const seen = { ...s.seen, [runId]: seq };
  let { runs, links } = s;
  if (e.type === 'CUSTOM' && e.name === 'agentview.run_info') {
    const v = e.value;
    runs = { ...runs, [runId]: { main: v.main, pattern: v.pattern ?? 'single', agents: (v.agents ?? []).map((a: { id: string }) => a.id), live: true, subs: {}, target: v.target, teams: (v.teams ?? []).map((t: { id: string }) => t.id) } };
  }
  const run = runs[runId];
  const linkKey = `${runId}/${e.subagentRunId}`;
  if (e.type === 'SUBAGENT_STARTED' && run) {
    runs = { ...runs, [runId]: { ...run, subs: { ...run.subs, [e.subagentRunId]: e.name } } };
    const from = e.parentSubagentRunId ? run.subs[e.parentSubagentRunId] : run.main;
    if (from && !isTeam(from) && !isTeam(e.name)) links = { ...links, [linkKey]: { from, to: e.name } };
  }
  if ((e.type === 'SUBAGENT_FINISHED' || e.type === 'SUBAGENT_ERROR') && links[linkKey]) {
    links = { ...links };
    delete links[linkKey];
  }

  if (e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR') {
    const status: Status = e.type === 'RUN_FINISHED' ? 'done' : 'error';
    const agents = { ...s.agents };
    for (const [id, v] of Object.entries(agents)) {
      if (v.runId === runId && v.status !== 'done' && v.status !== 'error') agents[id] = { status, runId, since: now };
    }
    if (run) runs = { ...runs, [runId]: { ...run, live: false } };
    links = Object.fromEntries(Object.entries(links).filter(([k]) => !k.startsWith(`${runId}/`)));
    return { agents, runs, links, seen };
  }

  const agentId: string | undefined =
    e.type === 'CUSTOM' && (e.name === 'agentview.queued' || e.name === 'agentview.resumed') ? e.value.agentId
    : e.subagentRunId ? runs[runId]?.subs[e.subagentRunId]
    : runs[runId]?.main;
  if (!agentId) return { ...s, runs, links, seen };
  const cur = s.agents[agentId];
  // what the agent is visibly doing: streamed text, or its current tool call; it keeps the status it already has
  if (e.type === 'TEXT_MESSAGE_CONTENT' && cur) {
    const say = ((cur.say ?? '') + e.delta).replace(/\s+/g, ' ').slice(-SAY_MAX);
    return { agents: { ...s.agents, [agentId]: { ...cur, say } }, runs, links, seen };
  }
  if (e.type === 'TOOL_CALL_ARGS' && cur?.tool) {
    return { agents: { ...s.agents, [agentId]: { ...cur, say: describeTool(cur.tool, e.delta) } }, runs, links, seen };
  }
  const next = nextStatus(e);
  if (!next) return { ...s, runs, links, seen };
  const say = e.type === 'TOOL_CALL_START' ? describeTool(e.toolCallName, '')
    : e.type === 'TEXT_MESSAGE_START' ? ''
    : e.type === 'CUSTOM' && e.name === 'agentview.queued' ? (e.value.reason === 'sandbox' ? '샌드박스 자리가 나길 기다리는 중' : '다른 일이 끝나길 기다리는 중')
    : cur?.runId === runId ? cur.say : undefined;
  return { agents: { ...s.agents, [agentId]: { ...next, runId, since: now, say } }, runs, links, seen };
}
