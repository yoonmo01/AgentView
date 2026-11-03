import { useEffect, useMemo, useState } from 'react';
import { api, type AgentDef } from '../api.ts';
import { LABEL, displayStatus, type AgentView, type AgUiEvent } from '../office/state.ts';
import { timeline, writtenFiles, type Item } from './timeline.ts';

type RunInfo = { runId: string; live: boolean; mtime: number; agents: string[] };
const TABS = { timeline: '타임라인', files: '작업 폴더', settings: '설정' } as const;
const time = (ms: number) => new Date(ms).toLocaleTimeString();

/** All events of one run: replayed from the start, then live until it ends. */
function useRunEvents(runId: string | null): AgUiEvent[] {
  const [events, setEvents] = useState<AgUiEvent[]>([]);
  useEffect(() => {
    setEvents([]);
    if (!runId) return;
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as AgUiEvent;
      setEvents((v) => [...v, e]);
      if (e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR') es.close();
    };
    return () => es.close();
  }, [runId]);
  return events;
}

function Entry({ item }: { item: Item }) {
  if (item.kind === 'run') return <li className={item.error ? 'tl-run error' : 'tl-run'}>{time(item.at)} · {item.text}</li>;
  if (item.kind === 'text') return <li className="tl-text">{item.text}</li>;
  return (
    <li className="tl-tool">
      <details>
        <summary>도구 {item.name} {item.result === undefined ? '(실행 중)' : `· ${(item.ms! / 1000).toFixed(1)}초`}</summary>
        <div>입력</div><pre>{item.args}</pre>
        {item.result !== undefined && <><div>결과</div><pre>{item.result}</pre></>}
      </details>
    </li>
  );
}

function Files({ agentId, changed }: { agentId: string; changed: Set<string> }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null);
  useEffect(() => {
    setOpen(null);
    api<string[]>(`/agents/${agentId}/files`).then(setFiles).catch(() => setFiles([]));
  }, [agentId, changed.size]);
  const show = (p: string) =>
    fetch(`/api/agents/${agentId}/files/${p.split('/').map(encodeURIComponent).join('/')}`)
      .then((r) => r.text()).then((text) => setOpen({ path: p, text }));
  if (!files) return <p>불러오는 중…</p>;
  if (!files.length) return <p>작업 폴더가 비어 있어요.</p>;
  return (
    <>
      <ul className="files">
        {files.map((f) => (
          <li key={f}><button aria-pressed={open?.path === f} onClick={() => show(f)}>{f}</button>{changed.has(f) && <span className="badge">이번 실행</span>}</li>
        ))}
      </ul>
      {open && <pre className="preview" aria-label={open.path}>{open.text}</pre>}
    </>
  );
}

export function Panel({ agent, view, now }: { agent: AgentDef; view: AgentView | undefined; now: number }) {
  const [tab, setTab] = useState<keyof typeof TABS>('timeline');
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    api<RunInfo[]>('/runs')
      .then((all) => {
        const mine = all.filter((r) => r.agents.includes(agent.id)).slice(0, 10);
        setRuns(mine);
        setRunId(view?.runId ?? mine[0]?.runId ?? null);
      })
      .catch(() => setRuns([]));
  }, [agent.id, view?.runId]);
  const events = useRunEvents(runId);
  const items = useMemo(() => timeline(events, agent.id), [events, agent.id]);
  const status = displayStatus(view, now);

  return (
    <section className="panel" aria-label={`${agent.name} 상세`}>
      <h3><span className="dot" style={{ background: agent.avatar.color }} /> {agent.name} <small>{agent.role}</small></h3>
      <p>
        지금: <b>{LABEL[status]}</b>
        {view?.tool && status !== 'idle' && ` · ${view.tool}`}
        {view && status !== 'idle' && ` · ${Math.max(0, Math.round((now - view.since) / 1000))}초째`}
      </p>
      <div role="tablist" className="tabs">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{TABS[k]}</button>
        ))}
      </div>
      {tab === 'timeline' && (
        runs.length === 0 ? <p>아직 실행 기록이 없어요.</p> : (
          <>
            <label className="runpick">실행
              <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value)}>
                {runs.map((r) => <option key={r.runId} value={r.runId}>{time(r.mtime)} {r.live ? '(진행 중)' : ''} {r.runId.slice(0, 8)}</option>)}
              </select>
              {runId && <a href={`/?run=${encodeURIComponent(runId)}`}>오피스에서 다시 보기</a>}
            </label>
            <ol className="timeline">{items.map((it, i) => <Entry key={i} item={it} />)}</ol>
          </>
        )
      )}
      {tab === 'files' && <Files agentId={agent.id} changed={writtenFiles(items)} />}
      {tab === 'settings' && (
        <dl className="settings">
          <dt>모델</dt><dd>{agent.connection} · {agent.model || '연결 기본값'}</dd>
          <dt>도구</dt><dd>{agent.tools.join(', ') || '없음'}</dd>
          <dt>샌드박스</dt><dd>{agent.sandbox.image} · 인터넷 {agent.sandbox.network ? '허용' : '차단'}</dd>
          <dt>최대 단계</dt><dd>{agent.maxSteps}</dd>
          <dt>지시문</dt><dd className="prompt">{agent.systemPrompt || '없음'}</dd>
          <dd><a href={`/admin?agent=${agent.id}`}>관리 화면에서 고치기</a></dd>
        </dl>
      )}
    </section>
  );
}
