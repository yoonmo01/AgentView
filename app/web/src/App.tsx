import { useEffect, useState } from 'react';
import { Settings, type SettingsTab } from './admin/Admin.tsx';
import { api, type AgentDef, type TeamDef } from './api.ts';
import { Dock } from './chat/Dock.tsx';
import { Office } from './office/Office.tsx';
import { useOffice } from './office/useOffice.ts';
import { Roster } from './shell/Roster.tsx';

/** One screen: the office fills it; the roster, the settings drawer and the chat float over it. */
export default function App() {
  const runId = new URLSearchParams(location.search).get('run');
  const state = useOffice(runId);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [teams, setTeams] = useState<TeamDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [settings, setSettings] = useState<{ tab: SettingsTab; focus?: string } | null>(null);
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
  const pick = (t: string) => { setTarget(t); setChatOpen(true); setSettings(null); };
  const openSettings = (s: typeof settings) => { setSettings(s); if (s) setChatOpen(false); };
  const selected = target?.startsWith('agent:') ? target.slice('agent:'.length) : null;

  return (
    <div className="screen">
      <Office agents={agents} teams={teams} state={state} now={now} selected={selected}
        onSelect={(id) => id && pick(`agent:${id}`)} onSelectTeam={(id) => pick(`team:${id}`)} />
      <Roster agents={agents} teams={teams} state={state} now={now} target={target} onPick={pick} />
      <button className="settings-btn" onClick={() => openSettings(settings ? null : { tab: 'agents' })} aria-expanded={!!settings}>⚙ 설정</button>
      {runId && <p className="banner">실행 다시 보기 · {runId} <a href="/">실시간으로 돌아가기</a></p>}
      {error && <p className="banner error">{error}</p>}
      {settings && (
        <Settings tab={settings.tab} focus={settings.focus} onTab={(tab) => setSettings({ tab })}
          onClose={() => setSettings(null)} onChanged={reload} />
      )}
      <Dock target={target} agents={agents} teams={teams} state={state} expanded={chatOpen}
        onExpand={(open) => { setChatOpen(open); if (open) setSettings(null); }}
        onSettings={(t) => openSettings({ tab: t.startsWith('team:') ? 'teams' : 'agents', focus: t.slice(t.indexOf(':') + 1) })} />
    </div>
  );
}
