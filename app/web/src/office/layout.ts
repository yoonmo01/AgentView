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
export const LOUNGE_SPOTS: Vec2[] = [{ x: 3.6, z: 5.9 }, { x: 5.4, z: 5.9 }, { x: 8.8, z: 6.6 }, { x: 9.6, z: 5.2 }];

export const LOW = 0.5;
export const TALL = 1.6;
export const WALL_T = 0.12;
type Wall = [x0: number, z0: number, x1: number, z1: number, height: number];
const door = (x0: number, x1: number, z: number, gap = 1.4): Wall[] => {
  const c = (x0 + x1) / 2;
  return [[x0, z, c - gap / 2, z, LOW], [c + gap / 2, z, x1, z, LOW]];
};
/** Tall outer walls at the back and sides, low walls inside so the camera sees over them; gaps are doors. */
export const WALLS: Wall[] = [
  [FLOOR.x0, FLOOR.z0, FLOOR.x1, FLOOR.z0, TALL], [FLOOR.x0, FLOOR.z0, FLOOR.x0, FLOOR.z1, TALL], [FLOOR.x1, FLOOR.z0, FLOOR.x1, FLOOR.z1, TALL],
  ...Array.from({ length: ROOMS }, (_, i) => door(teamRoom(i + 1).x0, teamRoom(i + 1).x1, teamRoom(1).z1)).flat(),
  ...Array.from({ length: ROOMS - 1 }, (_, i): Wall => [teamRoom(i + 1).x1, FLOOR.z0, teamRoom(i + 1).x1, teamRoom(1).z1, LOW]),
  [MEETING.x0, MEETING.z0, MEETING.x0, -0.6, LOW], [MEETING.x0, 0.8, MEETING.x0, 4.6, LOW], [MEETING.x0, 6, MEETING.x0, FLOOR.z1, LOW],
  ...door(MEETING.x0, MEETING.x1, MEETING.z1),
];

/** Shared-room furniture. `solid: false` props (chairs, rugs, things on a counter) do not block walking. */
export type Prop = { name: string; x: number; z: number; y?: number; rot?: number; size: [number, number, number]; color?: string; solid?: boolean };
const meet = center(MEETING);
const PLANT = { name: 'pottedPlant', size: [0.5, 1, 0.5] as [number, number, number], color: '#5c8a4d' };
export const PROPS: Prop[] = [
  ...Array.from({ length: ROOMS }, (_, i): Prop[] => {
    const r = teamRoom(i + 1);
    return [{ name: 'bookcaseOpen', x: r.x0 + 0.7, z: r.z0 + 0.35, size: [0.8, 1.76, 0.5] }, { ...PLANT, x: r.x1 - 0.5, z: r.z0 + 0.5 }];
  }).flat(),
  { name: 'tableRound', x: meet.x, z: meet.z, size: [1.4, 0.75, 1.6] },
  ...Array.from({ length: MEETING_SEATS }, (_, i): Prop => {
    const s = meetingSeat(i);
    return { name: 'chair', x: s.x, z: s.z, rot: Math.atan2(meet.x - s.x, meet.z - s.z), size: [0.4, 0.9, 0.4], solid: false };
  }),
  { name: 'rugRound', x: 4.5, y: 0.01, z: 4.8, size: [2.4, 0.02, 2.4], color: '#c9b8e0', solid: false },
  { name: 'loungeSofa', x: 4.5, z: 3.7, size: [2, 0.9, 0.85], color: '#7d9ac2' },
  { name: 'tableCoffee', x: 4.5, z: 5.1, size: [1.2, 0.4, 0.7] },
  { name: 'loungeChair', x: 7, z: 5, rot: -Math.PI / 2, size: [0.9, 0.8, 0.9], color: '#7d9ac2' },
  { name: 'kitchenBar', x: 10.5, z: 5.6, rot: -Math.PI / 2, size: [0.9, 0.85, 0.45] },
  { name: 'kitchenCoffeeMachine', x: 10.5, y: 0.85, z: 5.6, rot: -Math.PI / 2, size: [0.5, 0.6, 0.6], color: '#333333', solid: false },
  { ...PLANT, x: 10.4, z: 7.4 },
  { ...PLANT, x: -10.4, z: 7.4 },
  { ...PLANT, x: 0.9, z: -1.9 },
  { name: 'bookcaseOpen', x: -10.6, z: 2.5, rot: Math.PI / 2, size: [0.8, 1.76, 0.5] },
];
/** Desk footprint (width along x, depth along z), shared by the scene and the walking grid. */
export const DESK_SIZE = { w: 1.44, d: 0.9 };

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
