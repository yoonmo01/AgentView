import { useState } from 'react';
import { PATTERN_LABEL, type AgentDef, type TeamDef } from '../api.ts';
import { COLOR, LABEL, displayStatus, type OfficeState } from '../office/state.ts';

/** Small list over the office: every agent and team with its status color; picking one opens its chat. */
export function Roster({ agents, teams, state, now, target, onPick }: {
  agents: AgentDef[]; teams: TeamDef[]; state: OfficeState; now: number; target: string | null; onPick: (target: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const busy = agents.filter((a) => !['idle', 'done', 'error'].includes(displayStatus(state.agents[a.id], now))).length;
  return (
    <nav className="roster" aria-label="에이전트와 팀">
      <button className="roster-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>AgentView</b> <small>{busy ? `${busy}명 작업 중` : '모두 대기'}</small> <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul>
          {agents.map((a) => {
            const s = displayStatus(state.agents[a.id], now);
            return (
              <li key={a.id}>
                <button aria-pressed={target === `agent:${a.id}`} onClick={() => onPick(`agent:${a.id}`)} title={`${a.role || a.id} · ${LABEL[s]}`}>
                  <span className="dot" style={{ background: COLOR[s] }} /> {a.name} <small>{s === 'idle' ? a.role : LABEL[s]}</small>
                </button>
              </li>
            );
          })}
          {teams.length > 0 && <li className="roster-sep">팀</li>}
          {teams.map((t) => (
            <li key={t.id}>
              <button aria-pressed={target === `team:${t.id}`} onClick={() => onPick(`team:${t.id}`)}>
                <span className="square" /> {t.name} <small>{PATTERN_LABEL[t.pattern]}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
