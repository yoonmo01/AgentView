import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type Ev = { type: string; [key: string]: unknown };
type Listener = (runId: string, seq: number, e: Ev) => void;

export const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TERMINAL = new Set(['RUN_FINISHED', 'RUN_ERROR']);
export const isTerminal = (e: Ev) => TERMINAL.has(e.type);

export type Bus = ReturnType<typeof createBus>;

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

  function list(): { runId: string; live: boolean; mtime: number }[] {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const runId = f.slice(0, -'.jsonl'.length);
        return { runId, live: live.has(runId), mtime: statSync(path.join(dir, f)).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  return { emit, exists, history, follow, followAll, list };
}
