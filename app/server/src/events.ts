import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type Ev = { type: string; [key: string]: unknown };
type Listener = (runId: string, seq: number, e: Ev) => void;

export const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TERMINAL = new Set(['RUN_FINISHED', 'RUN_ERROR']);
export const isTerminal = (e: Ev) => TERMINAL.has(e.type);

export type Bus = ReturnType<typeof createBus>;

export type Step = { who: string; tool: string; args: string; result: string; ms: number };
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Every tool call of a run, attributed to the agent that made it: the compact activity a session keeps. */
export function summarizeRun(events: Ev[]): Step[] {
  let main = '';
  const subs: Record<string, string> = {};
  const open = new Map<string, Step & { at: number }>();
  const out: (Step & { at: number })[] = [];
  for (const e of events) {
    if (e.type === 'CUSTOM' && e.name === 'agentview.run_info') main = String((e.value as { main: string }).main);
    if (e.type === 'SUBAGENT_STARTED') subs[String(e.subagentRunId)] = String(e.name);
    const who = e.subagentRunId ? subs[String(e.subagentRunId)] ?? '?' : main;
    if (e.type === 'TOOL_CALL_START') {
      const s = { who, tool: String(e.toolCallName), args: '', result: '', ms: 0, at: Number(e.timestamp) };
      open.set(String(e.toolCallId), s);
      out.push(s);
    } else if (e.type === 'TOOL_CALL_ARGS') {
      const s = open.get(String(e.toolCallId));
      if (s) s.args += String(e.delta);
    } else if (e.type === 'TOOL_CALL_RESULT') {
      const s = open.get(String(e.toolCallId));
      if (s) { s.result = String(e.content); s.ms = Number(e.timestamp) - s.at; }
    }
  }
  return out.map(({ at: _at, ...s }) => ({ ...s, args: cut(s.args, 300), result: cut(s.result, 600) }));
}

export function createBus(dir: string) {
  mkdirSync(dir, { recursive: true });
  const live = new Map<string, Ev[]>(); // runs still in progress
  const listeners = new Set<Listener>();
  const file = (runId: string) => path.join(dir, `${runId}.jsonl`);

  function emit(runId: string, e: Ev): void {
    if (!RUN_ID.test(runId)) throw new Error(`invalid run id: ${runId}`);
    let evs = live.get(runId);
    if (!evs) live.set(runId, (evs = []));
    const ev: Ev = { ...e, timestamp: Date.now() };
    const seq = evs.length;
    evs.push(ev);
    // ponytail: one synchronous append per event; batch writes if token streams make this hot
    appendFileSync(file(runId), JSON.stringify(ev) + '\n');
    if (isTerminal(ev)) live.delete(runId);
    for (const l of listeners) l(runId, seq, ev);
  }

  function exists(runId: string): boolean {
    return RUN_ID.test(runId) && (live.has(runId) || existsSync(file(runId)));
  }

  function history(runId: string): Ev[] {
    const evs = live.get(runId);
    if (evs) return evs;
    if (!exists(runId)) return [];
    return readFileSync(file(runId), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ev);
  }

  /** Past events after `after`, then live ones, until the run's terminal event. Returns unsubscribe. */
  function follow(runId: string, after: number, write: (seq: number, e: Ev) => void, end: () => void): () => void {
    let last = after;
    let done = false;
    const off = () => { listeners.delete(listener); };
    const finish = () => { done = true; off(); end(); };
    const send = (seq: number, e: Ev) => {
      if (done || seq <= last) return;
      last = seq;
      write(seq, e);
      if (isTerminal(e)) finish();
    };
    const listener: Listener = (id, seq, e) => { if (id === runId) send(seq, e); };
    listeners.add(listener);
    const past = history(runId);
    past.forEach((e, i) => send(i, e));
    if (!done && past.length > 0 && !live.has(runId)) finish(); // finished run, nothing newer to send
    return off;
  }

  /** Every in-progress run from its start, then everything live. Returns unsubscribe. */
  function followAll(write: (runId: string, seq: number, e: Ev) => void): () => void {
    const listener: Listener = (id, seq, e) => write(id, seq, e);
    listeners.add(listener);
    for (const [id, evs] of live) evs.forEach((e, i) => write(id, i, e));
    return () => { listeners.delete(listener); };
  }

  /** First events of a finished run without reading the whole file (run_info is the second event). */
  function head(runId: string): Ev[] {
    const fd = openSync(file(runId), 'r');
    try {
      const buf = Buffer.alloc(16_384);
      const text = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
      return text.split('\n').slice(0, 3).flatMap((l) => { try { return [JSON.parse(l) as Ev]; } catch { return []; } });
    } finally {
      closeSync(fd);
    }
  }

  /** Newest runs first, with the target and participating agent ids from run_info. */
  function list(limit = 50): { runId: string; live: boolean; mtime: number; target?: string; agents: string[] }[] {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const runId = f.slice(0, -'.jsonl'.length);
        return { runId, live: live.has(runId), mtime: statSync(path.join(dir, f)).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((r) => {
        const info = (live.get(r.runId) ?? head(r.runId)).find((e) => e.name === 'agentview.run_info')?.value as
          { target?: string; agents?: { id: string }[] } | undefined;
        return { ...r, target: info?.target, agents: info?.agents?.map((a) => a.id) ?? [] };
      });
  }

  return { emit, exists, history, follow, followAll, list };
}
