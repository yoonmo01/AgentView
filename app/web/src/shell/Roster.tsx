import { Fragment, useState } from 'react';
import { PATTERN_LABEL, type AgentDef, type TeamDef } from '../api.ts';
import { displayStatus, type OfficeState } from '../office/state.ts';
import { Avatar, Chip, TeamMark, TeamMembers } from './ui.tsx';

/** Small list over the office: every agent with its status and every team; picking one makes it the chat target. */
export function Roster({ agents, teams, state, now, target, onPick }: {
  agents: AgentDef[]; teams: TeamDef[]; state: OfficeState; now: number; target: string | null; onPick: (target: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState<string | null>(null); // team whose members are listed
  const busy = agents.filter((a) => !['idle', 'done', 'error'].includes(displayStatus(state.agents[a.id], now))).length;
  return (
    <nav className="roster" aria-label="에이전트와 팀">
      <button className="roster-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>AgentView</b> <small>{busy ? `${busy}명 작업 중` : '모두 대기 중'}</small> <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="rows">
          <li className="rows-sep">에이전트</li>
          {agents.map((a) => (
            <li key={a.id}>
              <button aria-pressed={target === `agent:${a.id}`} onClick={() => onPick(`agent:${a.id}`)}>
                <Avatar agent={a} /><span className="row-text"><b>{a.name}</b><small>{a.role}</small></span>
                <Chip status={displayStatus(state.agents[a.id], now)} />
              </button>
            </li>
          ))}
          {teams.length > 0 && <li className="rows-sep">팀</li>}
          {teams.map((t) => (
            <Fragment key={t.id}>
              <li className="team-row">
                <button aria-pressed={target === `team:${t.id}`} onClick={() => onPick(`team:${t.id}`)}>
                  <TeamMark team={t} /><span className="row-text"><b>{t.name}</b><small>{PATTERN_LABEL[t.pattern]} · {t.members.length + 1}명</small></span>
                </button>
                <button className="icon" onClick={() => setShown((s) => s === t.id ? null : t.id)} aria-expanded={shown === t.id} aria-label={`${t.name} 구성 보기`}>
                  {shown === t.id ? '▾' : '▸'}
                </button>
              </li>
              {shown === t.id && <li><TeamMembers team={t} agents={agents} teams={teams} state={state} now={now} /></li>}
            </Fragment>
          ))}
        </ul>
      )}
    </nav>
  );
}
