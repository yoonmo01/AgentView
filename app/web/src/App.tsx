import { useEffect, useState } from 'react';
import { Office, type AgentInfo } from './office/Office.tsx';
import { LABEL, displayStatus } from './office/state.ts';
import { useOffice } from './office/useOffice.ts';

export default function App() {
  const runId = new URLSearchParams(location.search).get('run');
  const state = useOffice(runId);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setAgents)
      .catch(() => setError('서버에 연결할 수 없어요. server가 실행 중인지 확인하세요.'));
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const current = agents.find((a) => a.id === selected);
  const view = selected ? state.agents[selected] : undefined;
  return (
    <div className="app">
      <div className="stage">
        <Office agents={agents} state={state} now={now} selected={selected} onSelect={setSelected} />
      </div>
      <aside className="side">
        <h2>{runId ? `실행 다시 보기: ${runId}` : '에이전트'}</h2>
        {error && <p className="error">{error}</p>}
        <ul>
          {agents.map((a) => (
            <li key={a.id}>
              <button aria-pressed={selected === a.id} onClick={() => setSelected(a.id)}>
                {a.name} — {LABEL[displayStatus(state.agents[a.id], now)]}
              </button>
            </li>
          ))}
        </ul>
        {current && (
          <section>
            <h3>{current.name}</h3>
            <p>{current.role}</p>
            <p>상태: {LABEL[displayStatus(view, now)]}{view?.tool ? ` (${view.tool})` : ''}</p>
            {view?.runId && <p><a href={`?run=${view.runId}`}>이 실행 다시 보기</a></p>}
          </section>
        )}
      </aside>
    </div>
  );
}
