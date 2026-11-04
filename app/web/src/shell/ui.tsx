import type { CSSProperties } from 'react';
import type { AgentDef } from '../api.ts';
import { COLOR, LABEL, type Status } from '../office/state.ts';

/** Status as a colored word: "대기 중", "작업 중"… The same chip everywhere an agent's state shows. */
export const Chip = ({ status }: { status: Status }) => (
  <span className="chip" style={{ '--c': COLOR[status] } as CSSProperties}>{LABEL[status]}</span>
);

/** The agent's character color with its initial, so it never reads as a status dot. */
export const Avatar = ({ agent }: { agent: Pick<AgentDef, 'name' | 'avatar'> }) => (
  <span className="avatar" style={{ background: agent.avatar.color }} aria-hidden>{agent.name.slice(0, 1).toUpperCase()}</span>
);
