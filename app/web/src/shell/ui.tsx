import type { CSSProperties } from 'react';
import { MAIN_ROLE, type AgentDef, type TeamDef } from '../api.ts';
import { COLOR, displayStatus, LABEL, type OfficeState, type Status } from '../office/state.ts';

/** Status as a colored word: "대기 중", "작업 중"… The same chip everywhere an agent's state shows. */
export const Chip = ({ status }: { status: Status }) => (
  <span className="chip" style={{ '--c': COLOR[status] } as CSSProperties}>{LABEL[status]}</span>
);

/** The agent's character color with its initial, so it never reads as a status dot. */
export const Avatar = ({ agent }: { agent: Pick<AgentDef, 'name' | 'avatar'> }) => (
  <span className="avatar" style={{ background: agent.avatar.color }} aria-hidden>{agent.name.slice(0, 1).toUpperCase()}</span>
);

/** A team's color mark. */
export const TeamMark = ({ team }: { team?: Pick<TeamDef, 'color'> }) => (
  <span className="square" style={{ background: team?.color || undefined }} aria-hidden />
);

/** Who is in a team: the main agent (★) first, then members with their status; a nested team shows as its mark. */
/** `stack`: overlapping avatars only (names in the tooltip), for a header. */
export function TeamMembers({ team, agents, teams, state, now, stack }: {
  team: TeamDef; agents: AgentDef[]; teams: TeamDef[]; state: OfficeState; now: number; stack?: boolean;
}) {
  return (
    <ul className={stack ? 'members stack' : 'members'}>
      {[team.main, ...team.members].map((m, i) => {
        const sub = m.startsWith('team:') ? teams.find((t) => `team:${t.id}` === m) : undefined;
        const a = agents.find((x) => x.id === m);
        return (
          <li key={m} title={`${sub ? `${sub.name} 팀` : a?.name ?? m} · ${i === 0 ? MAIN_ROLE[team.pattern] : '구성원'}${a ? ` · ${LABEL[displayStatus(state.agents[a.id], now)]}` : ''}`}>
            {sub ? <TeamMark team={sub} /> : a && <Avatar agent={a} />}
            <span>{i === 0 && '★ '}{sub ? `${sub.name} 팀` : a?.name ?? m}</span>
            {a && <i className="mini" style={{ background: COLOR[displayStatus(state.agents[a.id], now)] }} />}
          </li>
        );
      })}
    </ul>
  );
}
