import { expect, it } from 'vitest';
import { LOUNGE_SPOTS, meetingSeat, roomDesks, SEAT, teamRoom, type Vec2 } from './layout.ts';
import { buildGrid, findPath, isFree } from './nav.ts';

const desks = [1, 2, 3, 4].flatMap(roomDesks);
const grid = buildGrid(desks);
const seatOf = (d: Vec2) => ({ x: d.x, z: d.z - SEAT });
const walk = (from: Vec2, to: Vec2) => [from, ...findPath(grid, from, to)];
/** Every leg stays on walkable cells, except the first and last short steps off and onto a chair. */
const clear = (pts: Vec2[]) => pts.slice(1).every((b, n) => {
  const a = pts[n];
  if (n === 0 && !isFree(grid, a)) return true;
  if (n === pts.length - 2 && !isFree(grid, b)) return Math.hypot(b.x - a.x, b.z - a.z) < 0.8;
  // sample between grid lines: touching a cell corner exactly is not a collision (obstacles are already grown by the body radius)
  for (let k = 0; k < 50; k++) { const t = (k + 0.37) / 50; if (!isFree(grid, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false; }
  return true;
});

it('blocks walls, desks and chairs but leaves doors open', () => {
  const d = roomDesks(1)[0];
  expect(isFree(grid, d)).toBe(false);
  expect(isFree(grid, seatOf(d))).toBe(false); // the desk chair
  expect(isFree(grid, meetingSeat(0))).toBe(false); // a meeting-room chair
  expect(isFree(grid, { x: -5.5, z: -5 })).toBe(false); // wall between rooms 1 and 2
  expect(isFree(grid, { x: (teamRoom(1).x0 + teamRoom(1).x1) / 2, z: -2.5 })).toBe(true); // room 1 door
});

it('walks from a room desk to the lounge through doors, never through walls or furniture', () => {
  const pts = walk(seatOf(roomDesks(1)[0]), LOUNGE_SPOTS[0]);
  expect(pts.at(-1)).toEqual(LOUNGE_SPOTS[0]);
  expect(clear(pts)).toBe(true);
  expect(pts.length).toBeGreaterThan(2);
});

it('walks between rooms via the corridor and steps onto the target chair last', () => {
  const b = seatOf(roomDesks(2)[0]);
  const pts = walk(seatOf(roomDesks(1)[1]), b);
  expect(pts.at(-1)).toEqual(b);
  expect(clear(pts)).toBe(true);
  expect(Math.max(...pts.map((p) => p.z))).toBeGreaterThan(-2.5); // left room 1 through its door
});

it('reaches a meeting chair from the lobby', () => {
  const pts = walk({ x: -6, z: 4 }, meetingSeat(3));
  expect(pts.at(-1)).toEqual(meetingSeat(3));
  expect(clear(pts)).toBe(true);
});
