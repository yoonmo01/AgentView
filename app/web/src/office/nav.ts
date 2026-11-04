import { DESK_SIZE, FLOOR, PROPS, WALL_T, WALLS, type Prop, type Vec2 } from './layout.ts';

const CELL = 0.25;
const RADIUS = 0.22; // character half-width: obstacles grow by this much
const COLS = Math.round((FLOOR.x1 - FLOOR.x0) / CELL);
const ROWS = Math.round((FLOOR.z1 - FLOOR.z0) / CELL);

export type Grid = { blocked: Uint8Array };
type Box = { x0: number; z0: number; x1: number; z1: number };

const footprint = (p: Prop): Box => {
  const turned = Math.abs(Math.sin(p.rot ?? 0)) > 0.7; // a quarter turn swaps width and depth
  const [w, , d] = p.size;
  const hx = (turned ? d : w) / 2;
  const hz = (turned ? w : d) / 2;
  return { x0: p.x - hx, z0: p.z - hz, x1: p.x + hx, z1: p.z + hz };
};

const cellOf = (p: Vec2): [number, number] => [
  Math.min(COLS - 1, Math.max(0, Math.floor((p.x - FLOOR.x0) / CELL))),
  Math.min(ROWS - 1, Math.max(0, Math.floor((p.z - FLOOR.z0) / CELL))),
];
const centerOf = (i: number, j: number): Vec2 => ({ x: FLOOR.x0 + (i + 0.5) * CELL, z: FLOOR.z0 + (j + 0.5) * CELL });

/** Walkable cells: walls, desks and solid furniture (grown by the character radius) are blocked. */
export function buildGrid(desks: Vec2[]): Grid {
  const boxes: Box[] = [
    ...WALLS.map(([x0, z0, x1, z1]) => ({ x0: Math.min(x0, x1) - WALL_T / 2, z0: Math.min(z0, z1) - WALL_T / 2, x1: Math.max(x0, x1) + WALL_T / 2, z1: Math.max(z0, z1) + WALL_T / 2 })),
    ...PROPS.filter((p) => p.solid !== false).map(footprint),
    ...desks.map((d) => ({ x0: d.x - DESK_SIZE.w / 2, z0: d.z - DESK_SIZE.d / 2, x1: d.x + DESK_SIZE.w / 2, z1: d.z + DESK_SIZE.d / 2 })),
  ];
  const blocked = new Uint8Array(COLS * ROWS);
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const c = centerOf(i, j);
      if (boxes.some((b) => c.x > b.x0 - RADIUS && c.x < b.x1 + RADIUS && c.z > b.z0 - RADIUS && c.z < b.z1 + RADIUS)) blocked[j * COLS + i] = 1;
    }
  }
  return { blocked };
}

const free = (g: Grid, i: number, j: number) => i >= 0 && j >= 0 && i < COLS && j < ROWS && !g.blocked[j * COLS + i];
export const isFree = (g: Grid, p: Vec2) => free(g, ...cellOf(p));

/** Nearest walkable cell (breadth-first), for points that land inside furniture. */
function nearestFree(g: Grid, [i0, j0]: [number, number]): [number, number] {
  if (free(g, i0, j0)) return [i0, j0];
  const seen = new Set([j0 * COLS + i0]);
  const queue: [number, number][] = [[i0, j0]];
  while (queue.length) {
    const [i, j] = queue.shift()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, k = nj * COLS + ni;
      if (ni < 0 || nj < 0 || ni >= COLS || nj >= ROWS || seen.has(k)) continue;
      if (free(g, ni, nj)) return [ni, nj];
      seen.add(k);
      queue.push([ni, nj]);
    }
  }
  return [i0, j0];
}

/** True when the straight segment a→b crosses only walkable cells. */
function sees(g: Grid, a: Vec2, b: Vec2): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL / 2));
  for (let s = 1; s < steps; s++) {
    if (!isFree(g, { x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps })) return false;
  }
  return true;
}

/** A* over the grid, then shortened to the corners that matter. Returns waypoints after `from`, ending at `to`. */
export function findPath(g: Grid, from: Vec2, to: Vec2): Vec2[] {
  const [si, sj] = nearestFree(g, cellOf(from));
  const [gi, gj] = nearestFree(g, cellOf(to));
  const end = isFree(g, to) ? to : centerOf(gi, gj);
  const start = sj * COLS + si, goal = gj * COLS + gi;
  const cost = new Float32Array(COLS * ROWS).fill(Infinity);
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const h = (k: number) => { const dx = Math.abs((k % COLS) - gi), dz = Math.abs(Math.floor(k / COLS) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  // ponytail: linear-scan open list; fine for a 5k-cell floor, use a heap if the office grows a lot
  const open = new Set([start]);
  cost[start] = 0;
  while (open.size) {
    let k = -1, best = Infinity;
    for (const o of open) { const f = cost[o] + h(o); if (f < best) { best = f; k = o; } }
    if (k === goal) break;
    open.delete(k);
    const i = k % COLS, j = Math.floor(k / COLS);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = i + di, nj = j + dj;
      if (!free(g, ni, nj) || (di && dj && (!free(g, i + di, j) || !free(g, i, j + dj)))) continue; // no corner cutting
      const nk = nj * COLS + ni, c = cost[k] + (di && dj ? 1.414 : 1);
      if (c < cost[nk]) { cost[nk] = c; prev[nk] = k; open.add(nk); }
    }
  }
  if (prev[goal] === -1 && goal !== start) return [end]; // unreachable: walk straight rather than freeze
  const cells: Vec2[] = [];
  for (let k = goal; k !== start && k !== -1; k = prev[k]) cells.unshift(centerOf(k % COLS, Math.floor(k / COLS)));
  cells.push(end);
  const out: Vec2[] = [];
  let at = from;
  for (let n = 0; n < cells.length; n++) {
    if (n === cells.length - 1 || !sees(g, at, cells[n + 1])) { out.push(cells[n]); at = cells[n]; }
  }
  return out;
}
