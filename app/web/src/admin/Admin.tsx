import { Agents } from './Agents.tsx';
import { Mcp } from './Mcp.tsx';
import { Teams } from './Teams.tsx';

export const SETTINGS_TABS = { agents: '에이전트', teams: '팀', mcp: 'MCP' } as const;
export type SettingsTab = keyof typeof SETTINGS_TABS;

/** Settings drawer over the office: agents, teams and MCP servers. Closed most of the time. */
export function Settings({ tab, focus, onTab, onClose, onChanged }: {
  tab: SettingsTab; focus?: string; onTab: (t: SettingsTab) => void; onClose: () => void; onChanged: () => void;
}) {
  return (
    <aside className="drawer" aria-label="설정">
      <header>
        <div role="tablist" className="tabs">
          {(Object.keys(SETTINGS_TABS) as SettingsTab[]).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => onTab(k)}>{SETTINGS_TABS[k]}</button>
          ))}
        </div>
        <button className="icon" onClick={onClose} aria-label="설정 닫기">✕</button>
      </header>
      {/* key: remount so `focus` applies when the drawer is reopened on another agent or team */}
      {tab === 'agents' ? <Agents key={`a-${focus}`} focus={focus} onChanged={onChanged} />
        : tab === 'teams' ? <Teams key={`t-${focus}`} focus={focus} onChanged={onChanged} />
        : <Mcp onChanged={onChanged} />}
    </aside>
  );
}
