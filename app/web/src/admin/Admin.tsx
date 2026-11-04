import { useState } from 'react';
import { Agents } from './Agents.tsx';
import { Teams } from './Teams.tsx';

const TABS = { agents: '에이전트', teams: '팀' } as const;
type Tab = keyof typeof TABS;

export function Admin() {
  const initial = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState<Tab>(initial && initial in TABS ? (initial as Tab) : 'agents');
  return (
    <div className="admin-page">
      <div role="tablist" className="tabs admin-tabs">
        {(Object.keys(TABS) as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{TABS[k]}</button>
        ))}
      </div>
      {tab === 'agents' ? <Agents /> : <Teams />}
    </div>
  );
}
