import { useEffect, useState } from 'react';
import { api, type AgentDef, type TeamDef } from './api.ts';
import { Office } from './office/Office.tsx';
import { ICON, LABEL, displayStatus } from './office/state.ts';
import { useOffice } from './office/useOffice.ts';
import { Panel } from './panel/Panel.tsx';

export default function App() {
  const runId = new URLSearchParams(location.search).get('run');
  const state = useOffice(runId);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [teams, setTeams] = useState<TeamDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api<AgentDef[]>('/agents').then(setAgents).catch(() => setError('서버에 연결할 수 없어요. server가 실행 중인지 확인하세요.'));
    api<TeamDef[]>('/teams').then(setTeams).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const current = agents.find((a) => a.id === selected);
  const busy = agents.filter((a) => !['idle', 'done', 'error'].includes(displayStatus(state.agents[a.id], now))).length;
  return (
    <div className="app">
      <div className="stage">
        <Office agents={agents} teams={teams} state={state} now={now} selected={selected} onSelect={setSelected} />
      </div>
      <aside className="side">
        {runId && <p className="replay">실행 다시 보기 · {runId} <a href="/">실시간으로 돌아가기</a></p>}
        <h2>에이전트 <small>{busy}명 작업 중 · 전체 {agents.length}명</small></h2>
        {error && <p className="error">{error}</p>}
        <ul className="agents">
          {agents.map((a) => {
            const s = displayStatus(state.agents[a.id], now);
            const team = teams.find((t) => t.main === a.id || t.members.includes(a.id));
            return (
              <li key={a.id}>
                <button aria-pressed={selected === a.id} onClick={() => setSelected(selected === a.id ? null : a.id)}>
                  <span className="dot" style={{ background: a.avatar.color }} />
                  <span className="who"><b>{a.name}</b><small>{a.role || a.id}{team ? ` · ${team.name}` : ''}</small></span>
                  <span className={`chip chip-${s}`}>{ICON[s]} {LABEL[s]}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {current && <Panel agent={current} view={state.agents[current.id]} now={now} />}
      </aside>
    </div>
  );
}
