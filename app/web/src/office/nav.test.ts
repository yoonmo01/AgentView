import { expect, it } from 'vitest';
import { LOUNGE_SPOTS, roomDesks, SEAT, teamRoom, type Vec2 } from './layout.ts';
import { buildGrid, findPath, isFree } from './nav.ts';

const desks = [1, 2, 3, 4].flatMap(roomDesks);
const grid = buildGrid(desks);
const walk = (from: Vec2, to: Vec2) => [from, ...findPath(grid, from, to)];
/** Every leg of the path stays on walkable cells (sampled finely). */
const clear = (pts: Vec2[]) => pts.slice(1).every((b, n) => {
  const a = pts[n];
  for (let t = 0; t <= 1; t += 0.02) if (!isFree(grid, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  return true;
});

it('blocks walls and desks but leaves seats and doors open', () => {
  const d = roomDesks(1)[0];
  expect(isFree(grid, d)).toBe(false);
  expect(isFree(grid, { x: d.x, z: d.z - SEAT })).toBe(true);
  expect(isFree(grid, { x: -5.5, z: -5 })).toBe(false); // wall between rooms 1 and 2
  expect(isFree(grid, { x: (teamRoom(1).x0 + teamRoom(1).x1) / 2, z: -2.5 })).toBe(true); // room 1 door
});

it('walks from a room desk to the lounge through doors, never through walls', () => {
  const seat = { x: roomDesks(1)[0].x, z: roomDesks(1)[0].z - SEAT };
  const pts = walk(seat, LOUNGE_SPOTS[0]);
  expect(pts.at(-1)).toEqual(LOUNGE_SPOTS[0]);
  expect(clear(pts)).toBe(true);
  expect(pts.length).toBeGreaterThan(2); // had to turn at least once
});

it('walks between neighbouring rooms via the corridor', () => {
  const a = { x: roomDesks(1)[1].x, z: roomDesks(1)[1].z - SEAT };
  const b = { x: roomDesks(2)[0].x, z: roomDesks(2)[0].z - SEAT };
  const pts = walk(a, b);
  expect(clear(pts)).toBe(true);
  expect(Math.max(...pts.map((p) => p.z))).toBeGreaterThan(-2.5); // left room 1 through its door
});
