import { useEffect, useRef, useState } from 'react';
import { Settings, type SettingsTab } from './admin/Admin.tsx';
import { api, type AgentDef, type TeamDef } from './api.ts';
import { Dock } from './chat/Dock.tsx';
import { Office } from './office/Office.tsx';
import { useOffice } from './office/useOffice.ts';
import { Roster } from './shell/Roster.tsx';

/** One screen: the office fills it; the roster, the settings drawer and the chat float over it. */
export default function App() {
  const query = new URLSearchParams(location.search);
  const runId = query.get('run');
  const state = useOffice(runId, Math.min(Math.max(Number(query.get('speed')) || 1, 0.25), 16));
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [teams, setTeams] = useState<TeamDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // stays set while the drawer is closed, so it slides out with its content and reopens on the last tab
  const [settings, setSettings] = useState<{ tab: SettingsTab; focus?: string }>({ tab: 'agents' });
  const chatBefore = useRef(false); // the chat's state when settings opened, restored when they close
  const [now, setNow] = useState(Date.now());

  const reload = () => {
    api<AgentDef[]>('/agents').then((l) => { setAgents(l); setError(null); }).catch(() => setError('서버에 연결할 수 없어요. server가 실행 중인지 확인하세요.'));
    api<TeamDef[]>('/teams').then(setTeams).catch(() => {});
  };
  useEffect(() => {
    reload();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // one panel on the right at a time: the chat and the settings drawer never overlap
  // picking only changes who the chat talks to; the chat opens and closes with its own button
  const openSettings = (s: typeof settings) => {
    if (!settingsOpen) { chatBefore.current = chatOpen; setChatOpen(false); }
    setSettings(s);
    setSettingsOpen(true);
  };
  const closeSettings = () => { if (settingsOpen) { setSettingsOpen(false); setChatOpen(chatBefore.current); } };
  const pick = (t: string) => { setTarget(t); closeSettings(); };
  const selected = target?.startsWith('agent:') ? target.slice('agent:'.length) : null;
  const selectedTeam = target?.startsWith('team:') ? target.slice('team:'.length) : null;

  return (
    <div className="screen">
      <Office agents={agents} teams={teams} state={state} now={now} selected={selected} selectedTeam={selectedTeam}
        onSelect={(id) => id && pick(`agent:${id}`)} onSelectTeam={(id) => pick(`team:${id}`)} />
      <Roster agents={agents} teams={teams} state={state} now={now} target={target} onPick={pick} />
      <button className="settings-btn" onClick={() => settingsOpen ? closeSettings() : openSettings({ tab: settings.tab })} aria-expanded={settingsOpen}>⚙ 설정</button>
      {runId && <p className="banner">실행 다시 보기 · {runId} <a href="/">실시간으로 돌아가기</a></p>}
      {error && <p className="banner error">{error}</p>}
      <Settings open={settingsOpen} tab={settings.tab} focus={settings.focus} onTab={(tab) => setSettings({ tab })}
        onClose={closeSettings} onChanged={reload} />
      <Dock target={target} agents={agents} teams={teams} state={state} expanded={chatOpen} beside={settingsOpen}
        onExpand={(open) => { if (open) setSettingsOpen(false); setChatOpen(open); }}
        onSettings={(t) => openSettings({ tab: t.startsWith('team:') ? 'teams' : 'agents', focus: t.slice(t.indexOf(':') + 1) })} />
    </div>
  );
}
