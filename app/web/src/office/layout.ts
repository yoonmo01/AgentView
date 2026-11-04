import type { AgentDef, TeamDef } from '../api.ts';

// ponytail: the floor plan is a constant; data/layout.json and an editor arrive when someone wants to rearrange rooms
export type Vec2 = { x: number; z: number };
export type Rect = { x0: number; z0: number; x1: number; z1: number };

export const ROOMS = 4;
const ROOM_W = 5.5;
export const FLOOR: Rect = { x0: -11, z0: -8, x1: 11, z1: 8 };
export const teamRoom = (r: number): Rect => ({ x0: -11 + (r - 1) * ROOM_W, z0: -8, x1: -11 + r * ROOM_W, z1: -2.5 });
export const LOBBY: Rect = { x0: -11, z0: -2.5, x1: 1.5, z1: 8 };
export const MEETING: Rect = { x0: 1.5, z0: -2.5, x1: 11, z1: 3 };
export const LOUNGE: Rect = { x0: 1.5, z0: 3, x1: 11, z1: 8 };
export const center = (r: Rect): Vec2 => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

/** Desk centers. Characters sit behind the desk (toward -z) and face the camera (+z). */
export const SEAT = 0.8;
export const roomDesks = (r: number): Vec2[] => {
  const c = center(teamRoom(r));
  return [[-1.3, -0.9], [1.3, -0.9], [-1.3, 1.5], [1.3, 1.5]].map(([dx, dz]) => ({ x: c.x + dx, z: c.z + dz }));
};
// ponytail: 12 lobby desks; more unassigned agents than that share desks
export const LOBBY_DESKS: Vec2[] = Array.from({ length: 12 }, (_, i) => ({ x: -9.3 + (i % 4) * 2.7, z: 1.2 + Math.floor(i / 4) * 2.5 }));

export const MEETING_SEATS = 6;
export const meetingSeat = (i: number): Vec2 => {
  const c = center(MEETING);
  const a = ((i % MEETING_SEATS) / MEETING_SEATS) * Math.PI * 2;
  return { x: c.x + Math.sin(a) * 1.7, z: c.z + Math.cos(a) * 1.5 };
};
/** Spots idle characters wander to: in front of the sofas and the coffee machine. */
export const LOUNGE_SPOTS: Vec2[] = [{ x: 3.6, z: 5.6 }, { x: 5.4, z: 5.6 }, { x: 8.8, z: 6.6 }, { x: 9.6, z: 5.2 }];

export type Placement = { desk: Vec2; room: number | null };

/** Each agent's desk: in the room of its first team (by id) that has a room and a free desk, else the lobby. */
export function placeAgents(agents: AgentDef[], teams: TeamDef[]): Map<string, Placement> {
  const known = new Set(agents.map((a) => a.id));
  const out = new Map<string, Placement>();
  const free = new Map<number, Vec2[]>();
  for (const t of [...teams].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!t.room) continue;
    if (!free.has(t.room)) free.set(t.room, roomDesks(t.room));
    for (const id of [t.main, ...t.members]) {
      if (out.has(id) || !known.has(id)) continue; // nested `team:` members are not people
      const desk = free.get(t.room)!.shift();
      if (desk) out.set(id, { desk, room: t.room });
    }
  }
  let i = 0;
  for (const a of agents) if (!out.has(a.id)) out.set(a.id, { desk: LOBBY_DESKS[i++ % LOBBY_DESKS.length], room: null });
  return out;
}
