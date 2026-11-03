import { useEffect, useState } from 'react';
import { api, type AgentDef } from './api.ts';
import { Office } from './office/Office.tsx';
import { LABEL, displayStatus } from './office/state.ts';
import { useOffice } from './office/useOffice.ts';
import { Panel } from './panel/Panel.tsx';

export default function App() {
  const runId = new URLSearchParams(location.search).get('run');
  const state = useOffice(runId);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api<AgentDef[]>('/agents').then(setAgents).catch(() => setError('서버에 연결할 수 없어요. server가 실행 중인지 확인하세요.'));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const current = agents.find((a) => a.id === selected);
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
        {current && <Panel agent={current} view={state.agents[current.id]} now={now} />}
      </aside>
    </div>
  );
}
