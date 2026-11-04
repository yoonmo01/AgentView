import { useEffect, useRef, useState, type FormEvent } from 'react';
import { summarizeRun } from '../../../server/src/summary.ts';
import { api, PATTERN_LABEL, readSse, type AgentDef, type ModelConn, type Session, type SessionMessage, type Step, type TeamDef } from '../api.ts';
import { COLOR, describeTool, LABEL, displayStatus, type AgUiEvent, type OfficeState } from '../office/state.ts';
import { dayGroup, shortTime } from './dates.ts';
import { Files } from './Files.tsx';

type Line = { key: string; role: SessionMessage['role']; text: string; steps?: Step[]; model?: string | null; at?: string };

const toLines = (ms: SessionMessage[]): Line[] => ms.map((m) => ({
  key: String(m.id), role: m.role, text: m.content, model: m.model, at: m.createdAt,
  ...(m.role === 'activity' ? { steps: JSON.parse(m.content) as Step[] } : {}),
}));

function Activity({ steps, live }: { steps: Step[]; live?: boolean }) {
  if (!steps.length) return null;
  return (
    <details className="activity" open={live}>
      <summary>{live ? '진행 중인 작업' : '작업 내역'} · {steps.length}단계</summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            <details>
              <summary><b>{s.who}</b> {describeTool(s.tool, s.args, !live)}{s.result ? ` · ${(s.ms / 1000).toFixed(1)}초` : ' …'}</summary>
              {s.args && <pre>{s.args}</pre>}
              {s.result && <pre>{s.result}</pre>}
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Bottom-right chat with the picked agent or team. A session is one continuing conversation, saved on the server;
 * picking an old session shows it and continues it. The model can change per message.
 */
export function Dock({ target, agents, teams, state, expanded, onExpand, onSettings }: {
  target: string | null; agents: AgentDef[]; teams: TeamDef[]; state: OfficeState;
  expanded: boolean; onExpand: (open: boolean) => void; onSettings: (target: string) => void;
}) {
  const [connections, setConnections] = useState<ModelConn[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [live, setLive] = useState<{ runId: string; events: AgUiEvent[] } | null>(null);
  const [text, setText] = useState('');
  const [model, setModel] = useState('');
  const [view, setView] = useState<'chat' | 'files'>('chat');
  const [dbOff, setDbOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const justStarted = useRef<string | null>(null); // a session send() just created: keep its optimistic lines

  const isTeam = target?.startsWith('team:') ?? false;
  const team = isTeam ? teams.find((t) => `team:${t.id}` === target) : undefined;
  const agent = agents.find((a) => `agent:${a.id}` === target) ?? (team ? agents.find((a) => a.id === team.main) : undefined);
  const name = team?.name ?? agent?.name ?? '';
  const conn = connections.find((c) => c.id === agent?.connection);
  const defaultModel = agent?.model || conn?.defaultModel || '';
  const status = agent && !team ? displayStatus(state.agents[agent.id], Date.now()) : 'idle';

  useEffect(() => { api<ModelConn[]>('/models').then(setConnections).catch(() => {}); }, []);
  useEffect(() => {
    if (!conn) return;
    api<string[]>(`/models/${conn.id}/available`).then(setModels).catch(() => setModels([]));
  }, [conn?.id]);

  const loadSessions = () => target
    ? api<Session[]>(`/sessions?target=${encodeURIComponent(target)}`).then((l) => { setSessions(l); setDbOff(false); return l; })
      .catch(() => { setDbOff(true); return [] as Session[]; })
    : Promise.resolve([] as Session[]);
  // a new target opens its most recent session, so the conversation simply continues
  useEffect(() => {
    setLines([]); setSessionId(null); setView('chat'); setError(null); setModel('');
    void loadSessions().then((l) => setSessionId(l[0]?.id ?? null));
  }, [target]);
  useEffect(() => {
    if (!sessionId || dbOff || justStarted.current === sessionId) return;
    api<Session & { messages: SessionMessage[] }>(`/sessions/${sessionId}`).then((s) => setLines(toLines(s.messages))).catch(() => setLines([]));
  }, [sessionId]);
  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight); }, [lines, live, expanded]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const content = text.trim();
    if (!content || !target || live) return;
    const sid = sessionId ?? crypto.randomUUID();
    const runId = crypto.randomUUID();
    const history = lines.filter((l) => l.role === 'user' || l.role === 'assistant').map((l) => ({ id: l.key, role: l.role, content: l.text }));
    setText('');
    setError(null);
    justStarted.current = sid;
    setSessionId(sid);
    setLines((ls) => [...ls, { key: `u-${runId}`, role: 'user', text: content, model: model || null, at: new Date().toISOString() }]);
    setLive({ runId, events: [] });
    onExpand(true);
    try {
      const res = await fetch('/api/agui', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId: sid, runId, tools: [], context: [], state: null,
          messages: [...history, { id: `u-${runId}`, role: 'user', content }],
          forwardedProps: { target, ...(model ? { model } : {}) },
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      const events: AgUiEvent[] = [];
      await readSse(res, (ev) => { events.push(ev); setLive({ runId, events: [...events] }); });
      const end = events.at(-1);
      if (dbOff) { // no database: keep the outcome in memory only
        const steps = summarizeRun(events);
        setLines((ls) => [...ls,
          ...(steps.length ? [{ key: `a-${runId}`, role: 'activity' as const, text: '', steps }] : []),
          end?.type === 'RUN_FINISHED' ? { key: `r-${runId}`, role: 'assistant' as const, text: String(end.result ?? ''), model: model || defaultModel }
            : { key: `e-${runId}`, role: 'error' as const, text: String(end?.message ?? '실행이 끝나지 않았어요') }]);
      } else {
        const s = await api<Session & { messages: SessionMessage[] }>(`/sessions/${sid}`);
        setLines(toLines(s.messages));
        void loadSessions();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLive(null);
    }
  }

  async function removeSession(s: Session) {
    if (!confirm(`"${s.title}" 대화를 지울까요? 실행 기록 파일은 남아요.`)) return;
    await api(`/sessions/${s.id}`, { method: 'DELETE' }).catch(() => {});
    const l = await loadSessions();
    if (s.id === sessionId) { setSessionId(l[0]?.id ?? null); if (!l.length) setLines([]); }
  }

  const liveSteps = live ? summarizeRun(live.events) : [];
  const liveText = live ? live.events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT' && !e.subagentRunId).map((e) => e.delta).join('') : '';
  const composer = (
    <form className="composer" onSubmit={send}>
      <textarea rows={expanded ? 2 : 1} value={text} disabled={!target}
        placeholder={target ? `${name}에게 메시지 (Enter 보내기, Shift+Enter 줄바꿈)` : '오피스에서 캐릭터나 팀 방을 눌러 대화 상대를 고르세요'}
        onFocus={() => target && onExpand(true)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div className="composer-bar">
        {expanded && conn && (
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="모델" title="이 메시지에 쓸 모델">
            <option value="">기본 모델 ({defaultModel || '연결 기본값'})</option>
            {models.filter((m) => m !== defaultModel).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {live
          ? <button type="button" className="danger" onClick={() => void fetch(`/api/runs/${live.runId}/cancel`, { method: 'POST' })}>취소</button>
          : <button type="submit" className="primary" disabled={!text.trim() || !target}>보내기</button>}
      </div>
    </form>
  );

  if (!expanded) {
    return (
      <section className="dock collapsed" aria-label="채팅">
        {target && (
          <button className="dock-who" onClick={() => onExpand(true)} title="대화 펼치기">
            {team ? <span className="square" /> : <span className="dot" style={{ background: COLOR[status] }} />} {name}
            {live && <small> 작업 중…</small>} <span aria-hidden>▴</span>
          </button>
        )}
        {composer}
      </section>
    );
  }

  let lastGroup = '';
  return (
    <section className="dock open" aria-label={`${name} 채팅`}>
      <aside className="sessions">
        <button className="primary" onClick={() => { setSessionId(null); setLines([]); setView('chat'); }} disabled={!target || !!live}>+ 새 대화</button>
        {dbOff && <p className="muted small">DB가 꺼져 있어 대화가 저장되지 않아요 (npm run db).</p>}
        <ul>
          {sessions.map((s) => {
            const g = dayGroup(s.updatedAt);
            const head = g !== lastGroup ? (lastGroup = g) : null;
            return (
              <li key={s.id}>
                {head && <div className="group">{head}</div>}
                <div className={`session${s.id === sessionId ? ' active' : ''}`}>
                  <button onClick={() => { justStarted.current = null; setSessionId(s.id); setView('chat'); }} disabled={!!live} title={s.title}>
                    <span>{s.title}</span><small>{shortTime(s.updatedAt)}</small>
                  </button>
                  <button className="icon" onClick={() => void removeSession(s)} aria-label={`${s.title} 지우기`} disabled={!!live}>✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="conversation">
        <header>
          {team ? <span className="square" /> : <span className="dot" style={{ background: COLOR[status] }} />}
          <div className="who"><b>{name}</b><small>{team ? `${PATTERN_LABEL[team.pattern]} 팀` : `${agent?.role || ''} · ${LABEL[status]}`}</small></div>
          {agent && !team && (
            <div className="tabs">
              <button aria-selected={view === 'chat'} onClick={() => setView('chat')}>대화</button>
              <button aria-selected={view === 'files'} onClick={() => setView('files')}>작업 폴더</button>
            </div>
          )}
          {target && <button className="icon" onClick={() => onSettings(target)} title="설정" aria-label="설정">⚙</button>}
          <button className="icon" onClick={() => onExpand(false)} aria-label="채팅 접기">▾</button>
        </header>
        {view === 'files' && agent ? <Files agentId={agent.id} refresh={lines.length} /> : (
          <div className="log" ref={log} aria-live="polite">
            {!target && <p className="muted">오피스에서 캐릭터나 팀 방을 눌러 대화 상대를 고르세요.</p>}
            {target && !lines.length && !live && <p className="muted">{sessionId ? '불러오는 중…' : `${name}에게 첫 메시지를 보내 보세요.`}</p>}
            {lines.map((l) => l.role === 'activity' ? <Activity key={l.key} steps={l.steps ?? []} /> : (
              <div key={l.key} className={`msg msg-${l.role}`}>
                <div className="text">{l.text}</div>
                {(l.model || l.at) && <small>{[l.model, l.at && shortTime(l.at)].filter(Boolean).join(' · ')}</small>}
              </div>
            ))}
            {live && (
              <>
                <Activity steps={liveSteps} live />
                <div className="msg msg-assistant live"><div className="text">{liveText || '생각 중…'}</div></div>
              </>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        )}
        {composer}
      </div>
    </section>
  );
}
