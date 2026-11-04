import { useState } from 'react';
import { PATTERN_LABEL, type AgentDef, type TeamDef } from '../api.ts';
import { displayStatus, type OfficeState } from '../office/state.ts';
import { Avatar, Chip } from './ui.tsx';

/** Small list over the office: every agent with its status and every team; picking one makes it the chat target. */
export function Roster({ agents, teams, state, now, target, onPick }: {
  agents: AgentDef[]; teams: TeamDef[]; state: OfficeState; now: number; target: string | null; onPick: (target: string) => void;
}) {
  const [open, setOpen] = useState(true);
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
            <li key={t.id}>
              <button aria-pressed={target === `team:${t.id}`} onClick={() => onPick(`team:${t.id}`)}>
                <span className="square" /><span className="row-text"><b>{t.name}</b><small>{PATTERN_LABEL[t.pattern]}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
