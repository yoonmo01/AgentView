import type { AgentDef, TeamDef } from '../api.ts';

// ponytail: one row of team rooms that widens with every team; a second row needs a corridor, add it when teams pass ~6
export type Vec2 = { x: number; z: number };
export type Rect = { x0: number; z0: number; x1: number; z1: number };
/** A desk. Its sitter is on the -z side facing the camera, or on the +z side facing back when `flip`. `lead` is the main agent's bigger desk. */
export type Desk = Vec2 & { flip?: boolean; lead?: boolean };
/** Where someone sits: the spot, the direction they face, and their desk if it is a desk seat (else a chair at a table). */
export type Seat = Vec2 & { face: number; desk?: Desk };
export type Wall = [x0: number, z0: number, x1: number, z1: number, height: number];
/** Furniture. `solid: false` props (rugs, things on a counter) do not block walking. */
export type Prop = { name: string; x: number; z: number; y?: number; rot?: number; size: [number, number, number]; color?: string; solid?: boolean };
/** A team's room: its own seat for every member, shaped by the team's pattern. */
export type Room = { team: TeamDef; rect: Rect; seats: Map<string, Seat>; desks: Desk[]; props: Prop[] };
export type Floor = {
  bounds: Rect; rooms: Room[]; lobby: Rect; meeting: Rect; lounge: Rect;
  lobbyDesks: Desk[]; waitSpots: Vec2[]; loungeSpots: Vec2[]; walls: Wall[]; props: Prop[];
};

export const SEAT = 0.8;
export const LOW = 0.5;
export const TALL = 1.6;
export const WALL_T = 0.12;
/** Desk footprint (width along x, depth along z); the lead desk is this much bigger. */
export const DESK_SIZE = { w: 1.44, d: 0.9 };
export const LEAD_SCALE = 1.25;
/** Desk chair: centered this far behind the desk center, and its footprint. */
export const DESK_CHAIR = { z: -SEAT - 0.1, size: 0.6 };
export const LEAD_CHAIR = '#c9a227';
export const center = (r: Rect): Vec2 => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
export const seatAt = (d: Desk): Seat => ({ x: d.x, z: d.flip ? d.z + SEAT : d.z - SEAT, face: d.flip ? Math.PI : 0, desk: d });

const MIN_ROOM_W = 5.5;
const MIN_ROOM_D = 5.5;
const MIN_FLOOR_W = 22;
const SIDE_W = 9.5; // meeting room and lounge width
const BOTTOM_D = 10.5; // lobby depth
const COL = 2.0; // desk spacing across
const ROW = 2.4; // desk spacing front to back
const PLANT = { name: 'pottedPlant', size: [0.5, 1, 0.5] as [number, number, number], color: '#5c8a4d' };

type Plan = { w: number; d: number; build: (cx: number, z0: number) => { seats: Map<string, Seat>; desks: Desk[]; props: Prop[] } };
const across = (i: number, cols: number) => (i % cols - (cols - 1) / 2) * COL;

/**
 * Room shape per pattern. `people` is [main, ...members] in order.
 * - supervisor: the lead desk at the back faces the members' rows (three per row) in front of it
 * - parallel: members side by side (four per row) facing the camera, the main's merge desk in front facing them
 * - debate: a round table; the moderator at the head (back), members clockwise in speaking order
 * - pipeline: everyone in work order left to right (four per row), the finisher's desk last
 * - review: like supervisor (the reviewer faces the workers); vote: like parallel (the judge faces the members)
 */
function plan(team: TeamDef, people: string[]): Plan {
  const [main, ...members] = people;
  const m = members.length;
  if (team.pattern === 'debate') {
    const n = people.length;
    const r = Math.max(1.3, n * 0.42);
    const w = Math.max(MIN_ROOM_W, 2 * r + 2.6), d = Math.max(MIN_ROOM_D, 2 * r + 3);
    return { w, d, build: (cx, z0) => {
      const c = { x: cx, z: z0 + d / 2 + 0.2 };
      const seats = new Map<string, Seat>();
      const props: Prop[] = [{ name: 'tableRound', x: c.x, z: c.z, size: [2 * r - 1.1, 0.75, 2 * r - 1.1] }, { ...PLANT, x: cx + w / 2 - 0.5, z: z0 + 0.5 }];
      people.forEach((id, k) => {
        const a = (k / n) * Math.PI * 2; // 0 = head of the table (back); growing angles go clockwise seen from above
        const p = { x: c.x + Math.sin(a) * r, z: c.z - Math.cos(a) * r };
        const face = Math.atan2(c.x - p.x, c.z - p.z);
        seats.set(id, { ...p, face });
        props.push({ name: 'chair', ...p, rot: face, size: [0.4, 0.9, 0.4], color: k === 0 ? LEAD_CHAIR : undefined });
      });
      return { seats, desks: [], props };
    } };
  }
  if (team.pattern === 'pipeline') {
    const cols = Math.max(1, Math.min(people.length, 4));
    const rows = Math.ceil(people.length / cols);
    const w = Math.max(MIN_ROOM_W, cols * COL + 1.6), d = Math.max(MIN_ROOM_D, 1.7 + (rows - 1) * ROW + SEAT + 1.6);
    return { w, d, build: (cx, z0) => {
      const desks: Desk[] = [];
      const seats = new Map<string, Seat>();
      // members first, the finisher last: the work moves along the row
      [...members, main].forEach((id, i) => {
        const desk: Desk = { x: cx + across(i, cols), z: z0 + 1.7 + Math.floor(i / cols) * ROW, lead: i === members.length };
        desks.push(desk);
        seats.set(id, seatAt(desk));
      });
      return { seats, desks, props: [{ name: 'bookcaseOpen', x: cx - w / 2 + 0.7, z: z0 + 0.35, size: [0.8, 1.76, 0.5] }, { ...PLANT, x: cx + w / 2 - 0.5, z: z0 + 0.5 }] };
    } };
  }
  const facing = team.pattern === 'parallel' || team.pattern === 'vote';
  const cols = Math.max(1, Math.min(m, facing ? 4 : 3));
  const rows = Math.ceil(m / cols);
  const w = Math.max(MIN_ROOM_W, cols * COL + 1.6);
  const supervisor = !facing;
  // depth: back margin, the lead or member rows, the merge desk for parallel, then room to walk by the door
  const lastSit = supervisor ? 3.5 + Math.max(0, rows - 1) * ROW + SEAT : 1.7 + Math.max(0, rows - 1) * ROW + 2.0 + SEAT;
  const d = Math.max(MIN_ROOM_D, lastSit + 1.1);
  return { w, d, build: (cx, z0) => {
    const desks: Desk[] = [];
    const seats = new Map<string, Seat>();
    const add = (id: string | undefined, desk: Desk) => { desks.push(desk); if (id) seats.set(id, seatAt(desk)); };
    if (supervisor) {
      add(main, { x: cx, z: z0 + 1.7, lead: true });
      members.forEach((id, i) => add(id, { x: cx + across(i, cols), z: z0 + 3.5 + Math.floor(i / cols) * ROW, flip: true }));
    } else {
      members.forEach((id, i) => add(id, { x: cx + across(i, cols), z: z0 + 1.7 + Math.floor(i / cols) * ROW }));
      add(main, { x: cx, z: z0 + 1.7 + Math.max(0, rows - 1) * ROW + 2.0, lead: true, flip: true });
    }
    const props: Prop[] = [{ name: 'bookcaseOpen', x: cx - w / 2 + 0.7, z: z0 + 0.35, size: [0.8, 1.76, 0.5] }, { ...PLANT, x: cx + w / 2 - 0.5, z: z0 + 0.5 }];
    return { seats, desks, props };
  } };
}

const door = (x0: number, x1: number, z: number, gap = 1.4): Wall[] => {
  const c = (x0 + x1) / 2;
  return [[x0, z, c - gap / 2, z, LOW], [c + gap / 2, z, x1, z, LOW]];
};

/**
 * The whole office from the teams: one room per team along the back (as wide and deep as its members need),
 * then the lobby, meeting room and lounge in front, stretched to the same width.
 */
export function buildFloor(teams: TeamDef[], agents: AgentDef[]): Floor {
  const known = new Set(agents.map((a) => a.id));
  const ordered = [...teams].sort((a, b) => (a.room ?? 1e9) - (b.room ?? 1e9) || a.id.localeCompare(b.id));
  const plans = ordered.map((t) => plan(t, [t.main, ...t.members].filter((id) => known.has(id)))); // nested `team:` members are not people
  const total = plans.reduce((s, p) => s + p.w, 0);
  const W = Math.max(MIN_FLOOR_W, total);
  const extra = plans.length ? (W - total) / plans.length : 0; // spread spare width over the rooms
  const D = plans.length ? Math.max(MIN_ROOM_D, ...plans.map((p) => p.d)) : 0;
  const x0 = -W / 2, x1 = W / 2;

  let x = x0;
  const rooms: Room[] = ordered.map((team, i) => {
    const w = plans[i].w + extra;
    const rect = { x0: x, z0: -D, x1: x + w, z1: 0 };
    x += w;
    return { team, rect, ...plans[i].build((rect.x0 + rect.x1) / 2, -D) };
  });

  const lobby = { x0, z0: 0, x1: x1 - SIDE_W, z1: BOTTOM_D };
  const meeting = { x0: lobby.x1, z0: 0, x1, z1: 5.5 };
  const lounge = { x0: lobby.x1, z0: 5.5, x1, z1: BOTTOM_D };
  const L = (dx: number, dz: number) => ({ x: lounge.x0 + dx, z: lounge.z0 + dz });
  const mc = center(meeting);
  const meetSeats = Array.from({ length: 6 }, (_, i) => ({ x: mc.x + Math.sin((i / 6) * Math.PI * 2) * 1.7, z: mc.z + Math.cos((i / 6) * Math.PI * 2) * 1.5 }));

  const walls: Wall[] = [
    [x0, -D, x1, -D, TALL], [x0, -D, x0, BOTTOM_D, TALL], [x1, -D, x1, BOTTOM_D, TALL],
    ...rooms.flatMap((r) => door(r.rect.x0, r.rect.x1, 0)),
    ...rooms.slice(0, -1).map((r): Wall => [r.rect.x1, -D, r.rect.x1, 0, LOW]),
    [meeting.x0, 0, meeting.x0, 1.9, LOW], [meeting.x0, 3.3, meeting.x0, 7.1, LOW], [meeting.x0, 8.5, meeting.x0, BOTTOM_D, LOW],
    ...door(meeting.x0, meeting.x1, meeting.z1),
  ];
  const props: Prop[] = [
    { name: 'tableRound', x: mc.x, z: mc.z, size: [1.4, 0.75, 1.6] },
    ...meetSeats.map((s): Prop => ({ name: 'chair', ...s, rot: Math.atan2(mc.x - s.x, mc.z - s.z), size: [0.4, 0.9, 0.4] })),
    { name: 'rugRound', ...L(3, 1.8), y: 0.01, size: [2.4, 0.02, 2.4], color: '#c9b8e0', solid: false },
    { name: 'loungeSofa', ...L(3, 0.7), size: [2, 0.9, 0.85], color: '#7d9ac2' },
    { name: 'tableCoffee', ...L(3, 2.1), size: [1.2, 0.4, 0.7] },
    { name: 'loungeChair', ...L(5.5, 2), rot: -Math.PI / 2, size: [0.9, 0.8, 0.9], color: '#7d9ac2' },
    { name: 'kitchenBar', ...L(9, 2.6), rot: -Math.PI / 2, size: [0.9, 0.85, 0.45] },
    { name: 'kitchenCoffeeMachine', ...L(9, 2.6), y: 0.85, rot: -Math.PI / 2, size: [0.5, 0.6, 0.6], color: '#333333', solid: false },
    { ...PLANT, ...L(8.9, 4.4) },
    { ...PLANT, x: x0 + 0.6, z: 9.9 },
    { ...PLANT, x: lobby.x1 - 0.6, z: 0.6 },
    { name: 'bookcaseOpen', x: x0 + 0.4, z: 5, rot: Math.PI / 2, size: [0.8, 1.76, 0.5] },
  ];
  return {
    bounds: { x0, z0: -D, x1, z1: BOTTOM_D }, rooms, lobby, meeting, lounge, walls, props,
    lobbyDesks: Array.from({ length: 8 }, (_, i) => ({ x: x0 + 1.7 + (i % 4) * 2.7, z: 3.7 + Math.floor(i / 4) * 2.5 })),
    waitSpots: Array.from({ length: 6 }, (_, i) => ({ x: x0 + 1.4 + i * 1.2, z: 9.3 })),
    loungeSpots: [L(2.1, 2.9), L(3.9, 2.9), L(7.3, 3.6), L(8.1, 2.2)],
  };
}

/**
 * Lobby desk per solo worker. Whoever already has a desk keeps it; newcomers take the lowest free one;
 * workers beyond the desks get none and wait standing (absent from the result).
 */
export function assignLobby(prev: Map<string, number>, working: string[], desks = 8): Map<string, number> {
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
