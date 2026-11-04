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
/** Shared lobby desks for solo work, taken in order; nobody owns one. */
export const LOBBY_DESKS: Vec2[] = Array.from({ length: 8 }, (_, i) => ({ x: -9.3 + (i % 4) * 2.7, z: 1.2 + Math.floor(i / 4) * 2.5 }));
/** Where solo workers stand while all lobby desks are taken. */
export const WAIT_SPOTS: Vec2[] = Array.from({ length: 6 }, (_, i) => ({ x: -9.6 + i * 1.2, z: 6.8 }));

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

/** Shared-room furniture. `solid: false` props (rugs, things on a counter) do not block walking. */
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
    return { name: 'chair', x: s.x, z: s.z, rot: Math.atan2(meet.x - s.x, meet.z - s.z), size: [0.4, 0.9, 0.4] };
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
/** Desk chair: centered this far behind the desk center (toward -z), and its footprint. */
export const DESK_CHAIR = { z: -SEAT - 0.1, size: 0.6 };

/** Each team member's own desk in that team's room: main first, then members in order. Teams without a room seat nobody. */
export function teamSeats(agents: AgentDef[], teams: TeamDef[]): Map<string, Map<string, Vec2>> {
  const known = new Set(agents.map((a) => a.id));
  return new Map(teams.map((t) => {
    const desks = t.room ? roomDesks(t.room) : [];
    const people = [t.main, ...t.members].filter((id) => known.has(id)); // nested `team:` members are not people
    return [t.id, new Map(people.slice(0, desks.length).map((id, i) => [id, desks[i]]))];
  }));
}

/**
 * Lobby desk per solo worker. Whoever already has a desk keeps it; newcomers take the lowest free one;
 * workers beyond the desks get none and wait standing (absent from the result).
 */
export function assignLobby(prev: Map<string, number>, working: string[], desks = LOBBY_DESKS.length): Map<string, number> {
  const out = new Map([...prev].filter(([id]) => working.includes(id)));
  const used = new Set(out.values());
  for (const id of working) {
    if (out.has(id)) continue;
    let d = 0;
    while (used.has(d)) d++;
    if (d >= desks) break;
    out.set(id, d);
    used.add(d);
  }
  return out;
}
