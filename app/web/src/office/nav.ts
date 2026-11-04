import { DESK_CHAIR, DESK_SIZE, LEAD_SCALE, WALL_T, type Desk, type Floor, type Prop, type Vec2 } from './layout.ts';

const CELL = 0.25;
const RADIUS = 0.22; // character half-width: obstacles grow by this much

/** Walkable cells over the floor's bounds. */
export type Grid = { blocked: Uint8Array; x0: number; z0: number; cols: number; rows: number };
type Box = { x0: number; z0: number; x1: number; z1: number };

const footprint = (p: Prop): Box => {
  const turned = Math.abs(Math.sin(p.rot ?? 0)) > 0.7; // a quarter turn swaps width and depth
  const [w, , d] = p.size;
  const hx = (turned ? d : w) / 2;
  const hz = (turned ? w : d) / 2;
  return { x0: p.x - hx, z0: p.z - hz, x1: p.x + hx, z1: p.z + hz };
};
/** A desk and its chair (behind it, or in front when flipped). */
const deskBoxes = (d: Desk): Box[] => {
  const k = d.lead ? LEAD_SCALE : 1, hw = (DESK_SIZE.w * k) / 2, hd = (DESK_SIZE.d * k) / 2, h = DESK_CHAIR.size / 2;
  const cz = d.z + (d.flip ? -DESK_CHAIR.z : DESK_CHAIR.z);
  return [{ x0: d.x - hw, z0: d.z - hd, x1: d.x + hw, z1: d.z + hd }, { x0: d.x - h, z0: cz - h, x1: d.x + h, z1: cz + h }];
};

const cellOf = (g: Grid, p: Vec2): [number, number] => [
  Math.min(g.cols - 1, Math.max(0, Math.floor((p.x - g.x0) / CELL))),
  Math.min(g.rows - 1, Math.max(0, Math.floor((p.z - g.z0) / CELL))),
];
const centerOf = (g: Grid, i: number, j: number): Vec2 => ({ x: g.x0 + (i + 0.5) * CELL, z: g.z0 + (j + 0.5) * CELL });

/** Walkable cells: walls, desks, chairs and solid furniture (grown by the character radius) are blocked. */
export function buildGrid(f: Floor): Grid {
  const boxes: Box[] = [
    ...f.walls.map(([x0, z0, x1, z1]) => ({ x0: Math.min(x0, x1) - WALL_T / 2, z0: Math.min(z0, z1) - WALL_T / 2, x1: Math.max(x0, x1) + WALL_T / 2, z1: Math.max(z0, z1) + WALL_T / 2 })),
    ...[...f.props, ...f.rooms.flatMap((r) => r.props)].filter((p) => p.solid !== false).map(footprint),
    ...[...f.lobbyDesks, ...f.rooms.flatMap((r) => r.desks)].flatMap(deskBoxes),
  ];
  const g: Grid = { x0: f.bounds.x0, z0: f.bounds.z0, cols: Math.round((f.bounds.x1 - f.bounds.x0) / CELL), rows: Math.round((f.bounds.z1 - f.bounds.z0) / CELL), blocked: new Uint8Array() };
  g.blocked = new Uint8Array(g.cols * g.rows);
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.cols; i++) {
      const c = centerOf(g, i, j);
      if (boxes.some((b) => c.x > b.x0 - RADIUS && c.x < b.x1 + RADIUS && c.z > b.z0 - RADIUS && c.z < b.z1 + RADIUS)) g.blocked[j * g.cols + i] = 1;
    }
  }
  return g;
}

const free = (g: Grid, i: number, j: number) => i >= 0 && j >= 0 && i < g.cols && j < g.rows && !g.blocked[j * g.cols + i];
export const isFree = (g: Grid, p: Vec2) => free(g, ...cellOf(g, p));

/** Nearest walkable cell (breadth-first), for points that land inside furniture. */
function nearestFree(g: Grid, [i0, j0]: [number, number]): [number, number] {
  if (free(g, i0, j0)) return [i0, j0];
  const seen = new Set([j0 * g.cols + i0]);
  const queue: [number, number][] = [[i0, j0]];
  while (queue.length) {
    const [i, j] = queue.shift()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, k = nj * g.cols + ni;
      if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows || seen.has(k)) continue;
      if (free(g, ni, nj)) return [ni, nj];
      seen.add(k);
      queue.push([ni, nj]);
    }
  }
  return [i0, j0];
}

/** True when the straight segment a→b crosses only walkable cells. */
function sees(g: Grid, a: Vec2, b: Vec2): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL / 6)); // fine enough not to skip a corner cell
  for (let s = 1; s < steps; s++) {
    if (!isFree(g, { x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps })) return false;
  }
  return true;
}

/**
 * A* over the grid, then shortened to the corners that matter. Returns waypoints after `from`, ending at `to`.
 * A blocked `to` (a seat on a chair) is reached by walking to the nearest free cell, then one short step in.
 */
export function findPath(g: Grid, from: Vec2, to: Vec2): Vec2[] {
  const [si, sj] = nearestFree(g, cellOf(g, from));
  const [gi, gj] = nearestFree(g, cellOf(g, to));
  const end = centerOf(g, gi, gj);
  const finish = (pts: Vec2[]) => (isFree(g, to) ? [...pts.slice(0, -1), to] : [...pts, to]);
  const COLS = g.cols;
  const start = sj * COLS + si, goal = gj * COLS + gi;
  const cost = new Float32Array(COLS * g.rows).fill(Infinity);
  const prev = new Int32Array(COLS * g.rows).fill(-1);
  const h = (k: number) => { const dx = Math.abs((k % COLS) - gi), dz = Math.abs(Math.floor(k / COLS) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  // ponytail: linear-scan open list; fine for a few-thousand-cell floor, use a heap if the office grows a lot
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
  if (prev[goal] === -1 && goal !== start) return [to]; // unreachable: walk straight rather than freeze
  const cells: Vec2[] = [];
  for (let k = goal; k !== start && k !== -1; k = prev[k]) cells.unshift(centerOf(g, k % COLS, Math.floor(k / COLS)));
  cells.push(end);
  const out: Vec2[] = [];
  let at = from;
  for (let n = 0; n < cells.length; n++) {
    if (n === cells.length - 1 || !sees(g, at, cells[n + 1])) { out.push(cells[n]); at = cells[n]; }
  }
  return finish(out);
}
