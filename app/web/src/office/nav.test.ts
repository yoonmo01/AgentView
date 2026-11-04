import { expect, it } from 'vitest';
import type { AgentDef, TeamDef } from '../api.ts';
import { buildFloor, seatAt, type Vec2 } from './layout.ts';
import { buildGrid, findPath, isFree } from './nav.ts';

const floor = buildFloor([
  { id: 'dev', pattern: 'supervisor', main: 'atlas', members: ['nova', 'milo'], room: 1, color: '' } as TeamDef,
  { id: 'talk', pattern: 'debate', main: 'milo', members: ['atlas', 'nova'], room: 2, color: '' } as TeamDef,
], ['atlas', 'nova', 'milo'].map((id) => ({ id }) as AgentDef));
const grid = buildGrid(floor);
const [dev, talk] = floor.rooms;
const walk = (from: Vec2, to: Vec2) => [from, ...findPath(grid, from, to)];
/** Every leg stays on walkable cells, except the first and last short steps off and onto a chair. */
const clear = (pts: Vec2[]) => pts.slice(1).every((b, n) => {
  const a = pts[n];
  if (n === 0 && !isFree(grid, a)) return true;
  if (n === pts.length - 2 && !isFree(grid, b)) return Math.hypot(b.x - a.x, b.z - a.z) < 0.8;
  // grazing a blocked cell's corner by a few centimeters is not a collision (obstacles are already grown by the body radius)
  const near = (p: Vec2) => [[0, 0], [0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]].some(([dx, dz]) => isFree(grid, { x: p.x + dx, z: p.z + dz }));
  for (let k = 0; k < 50; k++) { const t = (k + 0.37) / 50; if (!near({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false; }
  return true;
});

it('blocks walls, desks and chairs but leaves doors open', () => {
  const lead = dev.seats.get('atlas')!;
  expect(isFree(grid, lead.desk!)).toBe(false);
  expect(isFree(grid, lead)).toBe(false); // the lead's chair
  expect(isFree(grid, talk.seats.get('milo')!)).toBe(false); // a debate chair
  expect(isFree(grid, { x: dev.rect.x1, z: dev.rect.z0 + 1 })).toBe(false); // wall between the rooms
  expect(isFree(grid, { x: (dev.rect.x0 + dev.rect.x1) / 2, z: 0 })).toBe(true); // the dev room door
});

it('walks from a team seat to the lounge through doors, never through walls or furniture', () => {
  const pts = walk(dev.seats.get('nova')!, floor.loungeSpots[0]);
  expect(pts.at(-1)).toEqual(floor.loungeSpots[0]);
  expect(clear(pts)).toBe(true);
  expect(pts.length).toBeGreaterThan(2);
});

it('walks from one room to a debate chair in the next and sits down last', () => {
  const to = talk.seats.get('nova')!;
  const pts = walk(dev.seats.get('nova')!, to);
  expect(pts.at(-1)).toMatchObject({ x: to.x, z: to.z });
  expect(clear(pts)).toBe(true);
  expect(Math.max(...pts.map((p) => p.z))).toBeGreaterThan(0); // left the dev room through its door
});

it('reaches every lobby desk from the waiting spots', () => {
  for (const d of floor.lobbyDesks) expect(clear(walk(floor.waitSpots[0], seatAt(d)))).toBe(true);
});
