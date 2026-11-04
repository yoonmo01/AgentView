import { expect, it } from 'vitest';
import type { AgentDef, TeamDef } from '../api.ts';
import { assignLobby, buildFloor, center } from './layout.ts';

const agent = (id: string) => ({ id }) as AgentDef;
const team = (id: string, pattern: TeamDef['pattern'], main: string, members: string[], room = 1) => ({ id, pattern, main, members, room, color: '' }) as TeamDef;
const people = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);

it('supervisor room: the lead desk at the back faces member rows of three', () => {
  const ids = people(5);
  const [room] = buildFloor([team('dev', 'supervisor', 'a0', ids.slice(1))], ids.map(agent)).rooms;
  const lead = room.seats.get('a0')!;
  expect(lead.desk).toMatchObject({ lead: true });
  expect(lead.face).toBe(0); // toward the members (and the camera)
  const members = ids.slice(1).map((id) => room.seats.get(id)!);
  expect(members.every((s) => s.desk?.flip && s.face === Math.PI && s.z > lead.z)).toBe(true); // in front, facing the lead
  expect(new Set(members.map((s) => s.z)).size).toBe(2); // 4 members → two rows
});

it('parallel room: members side by side, the merge desk in front facing them', () => {
  const ids = people(4);
  const [room] = buildFloor([team('p', 'parallel', 'a0', ids.slice(1))], ids.map(agent)).rooms;
  const members = ids.slice(1).map((id) => room.seats.get(id)!);
  expect(new Set(members.map((s) => s.z)).size).toBe(1);
  expect(room.seats.get('a0')).toMatchObject({ face: Math.PI });
  expect(room.seats.get('a0')!.z).toBeGreaterThan(members[0].z);
});

it('debate room: the moderator at the head, members clockwise in speaking order', () => {
  const ids = ['mod', 'first', 'second', 'third'];
  const [room] = buildFloor([team('t', 'debate', 'mod', ids.slice(1))], ids.map(agent)).rooms;
  const c = center({ x0: room.rect.x0, z0: room.rect.z0, x1: room.rect.x1, z1: room.rect.z1 });
  const s = (id: string) => room.seats.get(id)!;
  expect(s('mod').z).toBeLessThan(Math.min(s('first').z, s('second').z, s('third').z)); // head = back
  expect(s('first').x).toBeGreaterThan(c.x); // clockwise seen from above: right side first
  expect(s('third').x).toBeLessThan(c.x);
  expect(s('second').z).toBeGreaterThan(s('mod').z);
  expect(room.desks).toEqual([]);
});

it('grows rooms with their members and the floor with the rooms; an agent gets a seat per team', () => {
  const small = buildFloor([team('a', 'supervisor', 'a0', ['a1'])], people(2).map(agent));
  const ids = people(10);
  const big = buildFloor([
    team('a', 'parallel', 'a0', ids.slice(1)), team('b', 'supervisor', 'a1', ids.slice(2), 2), team('c', 'debate', 'a2', ids.slice(3), 3),
  ], ids.map(agent));
  const w = (r: { rect: { x0: number; x1: number } }) => r.rect.x1 - r.rect.x0;
  expect(small.bounds.x1 - small.bounds.x0).toBe(22);
  expect(big.bounds.x1 - big.bounds.x0).toBeGreaterThan(22);
  expect(big.rooms[0].rect.z0).toBeLessThan(small.rooms[0].rect.z0); // deeper rooms for more rows
  expect(w(big.rooms[0])).toBeGreaterThan(5.5);
  expect(big.rooms.every((r) => r.seats.has('a5'))).toBe(true);
});

it('keeps lobby desks stable and lets extra solo workers wait', () => {
  let m = assignLobby(new Map(), ['a', 'b', 'c'], 2);
  expect([...m]).toEqual([['a', 0], ['b', 1]]); // c waits
  m = assignLobby(m, ['b', 'c']); // a finished: c takes the freed desk, b stays put
  expect([...m]).toEqual([['b', 1], ['c', 0]]);
});
