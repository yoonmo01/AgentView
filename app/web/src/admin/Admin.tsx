import { useEffect, useState } from 'react';
import { Agents } from './Agents.tsx';
import { Mcp } from './Mcp.tsx';
import { Teams } from './Teams.tsx';

export const SETTINGS_TABS = { agents: '에이전트', teams: '팀', mcp: 'MCP' } as const;
export type SettingsTab = keyof typeof SETTINGS_TABS;

/** Settings drawer over the office: agents, teams and MCP servers. Closed most of the time. */
export function Settings({ open, tab, focus, onTab, onClose, onChanged }: {
  open: boolean; tab: SettingsTab; focus?: string; onTab: (t: SettingsTab) => void; onClose: () => void; onChanged: () => void;
}) {
  const [rev, setRev] = useState(0); // fresh lists each time the drawer opens
  useEffect(() => { if (open) setRev((r) => r + 1); }, [open]);
  // always mounted so it can slide in and out; `inert` keeps the hidden drawer out of tab order and clicks
  return (
    <aside className={`drawer${open ? ' shown' : ''}`} aria-label="설정" aria-hidden={!open} inert={!open}>
      <header>
        <div role="tablist" className="tabs">
          {(Object.keys(SETTINGS_TABS) as SettingsTab[]).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => onTab(k)}>{SETTINGS_TABS[k]}</button>
          ))}
        </div>
        <button className="icon" onClick={onClose} aria-label="설정 닫기">✕</button>
      </header>
      {/* key: remount so `focus` applies when the drawer is reopened on another agent or team */}
      {tab === 'agents' ? <Agents key={`a-${focus}-${rev}`} focus={focus} onChanged={onChanged} />
        : tab === 'teams' ? <Teams key={`t-${focus}-${rev}`} focus={focus} onChanged={onChanged} />
        : <Mcp key={rev} onChanged={onChanged} />}
    </aside>
  );
}
