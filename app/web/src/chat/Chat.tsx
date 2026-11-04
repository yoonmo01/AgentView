import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, PATTERN_LABEL, readSse, type AgentDef, type TeamDef } from '../api.ts';
import { Office } from '../office/Office.tsx';
import { useOffice } from '../office/useOffice.ts';

type Line = { id: string; role: 'user' | 'assistant'; content: string; tools: string[]; error?: string };

/** Test chat: the conversation lives in browser memory and goes out whole with every AG-UI request. */
export function Chat() {
  const state = useOffice(null);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [teams, setTeams] = useState<TeamDef[]>([]);
  const [target, setTarget] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const threadId = useRef(crypto.randomUUID()).current;
  const log = useRef<HTMLOListElement>(null);

  useEffect(() => {
    api<AgentDef[]>('/agents').then((list) => { setAgents(list); setTarget((t) => t || (list[0] ? `agent:${list[0].id}` : '')); })
      .catch(() => setLines([{ id: 'x', role: 'assistant', content: '', tools: [], error: '서버에 연결할 수 없어요. server가 실행 중인지 확인하세요.' }]));
    api<TeamDef[]>('/teams').then(setTeams).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight); }, [lines]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || !target || runId) return;
    const user: Line = { id: crypto.randomUUID(), role: 'user', content, tools: [] };
    const reply: Line = { id: crypto.randomUUID(), role: 'assistant', content: '', tools: [] };
    const history = [...lines.filter((l) => l.content), user];
    setLines([...history, reply]);
    setText('');
    const rid = crypto.randomUUID();
    setRunId(rid);
    const patch = (f: (l: Line) => Line) => setLines((ls) => ls.map((l) => (l.id === reply.id ? f(l) : l)));
    try {
      const res = await fetch('/api/agui', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId, runId: rid, tools: [], context: [], state: null, forwardedProps: { target },
          messages: history.map(({ id, role, content }) => ({ id, role, content })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      await readSse(res, (ev) => {
        if (ev.subagentRunId) return; // the chat shows the main agent; the office and panel show the rest
        if (ev.type === 'TEXT_MESSAGE_CONTENT') patch((l) => ({ ...l, content: l.content + ev.delta }));
        else if (ev.type === 'TOOL_CALL_START') patch((l) => ({ ...l, tools: [...l.tools, ev.toolCallName] }));
        else if (ev.type === 'RUN_FINISHED' && typeof ev.result === 'string') patch((l) => ({ ...l, content: ev.result })); // final answer only
        else if (ev.type === 'RUN_ERROR') patch((l) => ({ ...l, error: ev.code === 'cancelled' ? '취소했어요.' : ev.message }));
      });
    } catch (err) {
      patch((l) => ({ ...l, error: (err as Error).message }));
    } finally {
      setRunId(null);
    }
  }

  return (
    <div className="chat-page">
      <section className="chat">
        <label>대상
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!runId}>
            <optgroup label="에이전트">
              {agents.map((a) => <option key={a.id} value={`agent:${a.id}`}>{a.name} ({a.role || a.id})</option>)}
            </optgroup>
            {teams.length > 0 && (
              <optgroup label="팀">
                {teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name} ({PATTERN_LABEL[t.pattern]})</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <ol className="messages" ref={log} aria-live="polite">
          {lines.map((l) => (
            <li key={l.id} className={`msg msg-${l.role}`}>
              {l.tools.length > 0 && <div className="tools">도구: {l.tools.join(', ')}</div>}
              {l.content || (!l.error && l.role === 'assistant' ? '…' : '')}
              {l.error && <div className="error">{l.error}</div>}
            </li>
          ))}
        </ol>
        <form onSubmit={send} className="composer">
          <textarea rows={3} value={text} placeholder="에이전트에게 시킬 일을 적으세요 (Enter 전송, Shift+Enter 줄바꿈)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
          {runId
            ? <button type="button" className="danger" onClick={() => void fetch(`/api/runs/${runId}/cancel`, { method: 'POST' })}>취소</button>
            : <button type="submit" className="primary" disabled={!text.trim() || !target}>보내기</button>}
        </form>
      </section>
      <div className="stage">
        <Office agents={agents} teams={teams} state={state} now={now} selected={null} onSelect={() => {}} />
      </div>
    </div>
  );
}
