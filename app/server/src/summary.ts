/** Pure (no Node imports) so the web app can import it too. */
type Ev = { type: string; [key: string]: unknown };

export type Step = { who: string; tool: string; args: string; result: string; ms: number };
export type Tokens = { input: number; output: number };
/** A run's model tokens in total and per agent. */
export type Usage = Tokens & { by: Record<string, Tokens> };
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

/** Adds up the run's `agentview.usage` events; null when the model reported none. */
export function sumUsage(events: Ev[]): Usage | null {
  const u: Usage = { input: 0, output: 0, by: {} };
  let any = false;
  for (const e of events) {
    if (e.type !== 'CUSTOM' || e.name !== 'agentview.usage') continue;
    const v = e.value as { agentId: string } & Tokens;
    const a = (u.by[v.agentId] ??= { input: 0, output: 0 });
    a.input += v.input; a.output += v.output; u.input += v.input; u.output += v.output;
    any = true;
  }
  return any ? u : null;
}
