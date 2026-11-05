import type { TeamDef } from '../api.ts';

/**
 * Where everything goes in a team's structure picture. Pure, so the readability rules can be tested for every size:
 * - each pattern has one fixed shape (tree, row chain, fan, circle);
 * - at most PER_ROW people per row, more rows instead of tighter spacing;
 * - connections are drawn along buses between rows (never through a person), a two-way pair as two parallel lines;
 * - every connection kind has its own color, line and name, and the legend lists the kinds a picture uses.
 */
export const W = 480;
export const R = 15;
export const PER_ROW = 5;
const GAP_X = 84; // centre to centre in a row
const ROW_H = 84; // centre to centre between rows
const LABEL_H = 28; // name under a circle
const OFF = 4; // half the distance between the two lines of a pair

export type Kind = 'work' | 'result' | 'submit' | 'fix' | 'input' | 'merge' | 'handoff' | 'turn' | 'report';
export const KINDS: Record<Kind, { label: string; color: string; dash?: string; width: number }> = {
  work: { label: '일 맡김', color: '#e8862a', width: 2 },
  result: { label: '결과 돌려줌', color: '#3b7ddd', dash: '5 4', width: 1.5 },
  submit: { label: '결과물 제출', color: '#3b7ddd', width: 2 },
  fix: { label: '수정 요청', color: '#8a5cd6', dash: '5 4', width: 1.5 },
  input: { label: '요청', color: '#8d867a', width: 1.5 },
  merge: { label: '결과 모음', color: '#3b7ddd', dash: '5 4', width: 1.5 },
  handoff: { label: '결과 넘김', color: '#e8862a', width: 2 },
  turn: { label: '발언 순서', color: '#8d867a', width: 1.5 },
  report: { label: '사회자에게 전달', color: '#3b7ddd', dash: '5 4', width: 1.5 },
};

export type Node = { id: string; x: number; y: number; main?: boolean; hub?: string };
/** A connection as a polyline; `arrow` marks the last point. `from`/`to` are the node ids it joins. */
export type Edge = { kind: Kind; points: [number, number][]; from: string; to: string };
export type Layout = { nodes: Node[]; edges: Edge[]; height: number; kinds: Kind[] };

/** x positions for n people in one row; with `corridor`, a free lane is kept in the middle for the bus trunk. */
function rowXs(n: number, corridor: boolean): number[] {
  if (!corridor) return Array.from({ length: n }, (_, i) => W / 2 + (i - (n - 1) / 2) * GAP_X);
  const left = Math.ceil(n / 2), right = n - left;
  return [
    ...Array.from({ length: left }, (_, i) => W / 2 - GAP_X / 2 - (left - 1 - i) * GAP_X),
    ...Array.from({ length: right }, (_, i) => W / 2 + GAP_X / 2 + i * GAP_X),
  ];
}
/** Where a line may leave a node downward: under its name (or under the small request pill). */
const below = (n: Node) => (n.hub ? n.y + 11 : n.y + R + LABEL_H - 10);
const rowsOf = <T>(xs: T[], per: number) => Array.from({ length: Math.ceil(xs.length / per) }, (_, r) => xs.slice(r * per, r * per + per));

/**
 * People in rows under (or over) a hub, joined by buses: a trunk from the hub through the middle, a rail per row,
 * a short drop to each person. `down`/`up` say which way each bus points; the two buses sit OFF apart.
 */
function tree(top: Node, members: string[], y0: number, buses: { kind: Kind; toMembers: boolean; side: 1 | -1 }[], bottom?: Node): { nodes: Node[]; edges: Edge[]; lastY: number } {
  const rows = rowsOf(members, members.length > PER_ROW ? PER_ROW - 1 : PER_ROW); // a corridor costs a seat per row
  const corridor = rows.length > 1;
  const nodes: Node[] = [];
  rows.forEach((row, r) => rowXs(row.length, corridor).forEach((x, i) => nodes.push({ id: row[i], x, y: y0 + r * ROW_H })));
  const lastY = y0 + (rows.length - 1) * ROW_H;
  const edges: Edge[] = [];
  for (const bus of buses) {
    const hub = bus.side === -1 || !bottom ? top : bottom;
    const above = hub === top;
    const o = bus.side * OFF;
    const tx = W / 2 + o;
    for (const n of nodes) {
      // rail just above (from a top hub) or below (to a bottom hub) the person's row
      const railY = above ? n.y - ROW_H / 2 + o : n.y + LABEL_H + 16 + o;
      const trunk: [number, number][] = above ? [[tx, below(top)], [tx, railY]] : [[tx, bottom!.y - R - 3], [tx, railY]];
      const reach: [number, number][] = [[n.x + o, railY], [n.x + o, above ? n.y - R - 3 : n.y + LABEL_H + 6]];
      const path = [...trunk, ...reach];
      edges.push(bus.toMembers
        ? { kind: bus.kind, points: path, from: hub.id, to: n.id }
        : { kind: bus.kind, points: path.reverse(), from: n.id, to: hub.id });
    }
  }
  return { nodes, edges, lastY };
}

export function layoutDiagram(team: Pick<TeamDef, 'pattern' | 'main' | 'members' | 'limits'>): Layout {
  const members = team.members.filter((m) => !m.startsWith('team:'));
  const main: Node = { id: team.main, x: W / 2, y: 34, main: true };
  let nodes: Node[] = [];
  let edges: Edge[] = [];
  let height: number;

  if (team.pattern === 'supervisor' || team.pattern === 'review') {
    const kinds: [Kind, Kind] = team.pattern === 'supervisor' ? ['work', 'result'] : ['fix', 'submit'];
    const t = tree(main, members, 34 + ROW_H + 10, [
      { kind: kinds[0], toMembers: true, side: -1 }, // main → members
      { kind: kinds[1], toMembers: false, side: 1 }, // members → main
    ]);
    nodes = [main, ...t.nodes];
    edges = t.edges;
    height = t.lastY + LABEL_H + 12;
  } else if (team.pattern === 'parallel' || team.pattern === 'vote') {
    const req: Node = { id: '', x: W / 2, y: 20, hub: team.pattern === 'vote' ? '같은 문제' : '요청' };
    const rows = Math.ceil(members.length / (members.length > PER_ROW ? PER_ROW - 1 : PER_ROW));
    const firstY = 20 + ROW_H * 0.85;
    const bottom: Node = { id: team.main, x: W / 2, y: firstY + (rows - 1) * ROW_H + LABEL_H + 10 + ROW_H * 0.55, main: true };
    const t = tree(req, members, firstY, [
      { kind: 'input', toMembers: true, side: -1 },
      { kind: 'merge', toMembers: false, side: 1 },
    ], bottom);
    nodes = [req, ...t.nodes, bottom];
    edges = t.edges;
    height = bottom.y + LABEL_H + 12;
  } else if (team.pattern === 'pipeline') {
    // left to right, the finisher last; a full row turns back the other way (snake), so arrows never cross
    const order = [...members, team.main];
    const rows = rowsOf(order, PER_ROW);
    rows.forEach((row, r) => {
      const full = rowXs(rows.length === 1 ? row.length : PER_ROW, false); // one row: centred
      const placed = (r % 2 ? [...full].reverse() : full).slice(0, row.length); // every other row runs right to left
      row.forEach((id, i) => nodes.push({ id, x: placed[i], y: 34 + r * ROW_H, main: id === team.main && r === rows.length - 1 && i === row.length - 1 }));
    });
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = nodes[i], b = nodes[i + 1];
      const pts: [number, number][] = a.y === b.y
        ? [[a.x + Math.sign(b.x - a.x) * (R + 3), a.y], [b.x - Math.sign(b.x - a.x) * (R + 5), b.y]]
        : [[a.x + (a.x > W / 2 ? R + 3 : -(R + 3)), a.y], [a.x + (a.x > W / 2 ? R + 22 : -(R + 22)), a.y], [b.x + (b.x > W / 2 ? R + 22 : -(R + 22)), b.y], [b.x + (b.x > W / 2 ? R + 5 : -(R + 5)), b.y]];
      edges.push({ kind: 'handoff', points: pts, from: a.id, to: b.id });
    }
    height = nodes[nodes.length - 1].y + LABEL_H + 12 + (rows.length - 1) * 0;
  } else {
    // debate: the moderator at the top of a circle, members clockwise; the circle grows so neighbours keep their distance
    const all = [team.main, ...members];
    const n = all.length;
    const place = (ry: number) => {
      const rx = Math.min(W / 2 - R - 30, ry * 1.6);
      return all.map((id, k) => {
        const a = (k / n) * Math.PI * 2;
        return { id, x: W / 2 + Math.sin(a) * rx, y: 34 + ry - Math.cos(a) * ry, main: k === 0 };
      });
    };
    // grow the circle until neighbours keep their distance and names on one height do not touch
    const roomy = (ps: Node[]) => ps.every((a, i) => ps.every((b, j) => j <= i
      || (Math.hypot(a.x - b.x, a.y - b.y) >= 2 * R + 26 && (Math.abs(a.y - b.y) >= 24 || Math.abs(a.x - b.x) >= 70))));
    let ry = 52;
    while (!roomy(place(ry)) && ry < 400) ry += 4;
    nodes = place(ry);
    const c = { x: W / 2, y: 34 + ry };
    /** A straight line between two people that starts and ends clear of their names (names sit below the circles). */
    const trim = (a: Node, b: Node, ea: number, eb: number): [number, number][] => {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const clear = (e: number, downward: boolean) => (downward ? Math.max(e, (R + 18) / Math.max(0.5, Math.abs(dx) / d)) : e);
      const sa = clear(ea, dy / d > 0.3), sb = clear(eb, dy / d < -0.3); // leaving downward / arriving from below
      return [[a.x + (dx / d) * sa, a.y + (dy / d) * sa], [b.x - (dx / d) * sb, b.y - (dy / d) * sb]];
    };
    const speakers = nodes.slice(1);
    speakers.slice(0, -1).forEach((s, i) => edges.push({ kind: 'turn', points: trim(s, speakers[i + 1], R + 3, R + 5), from: s.id, to: speakers[i + 1].id }));
    if (speakers.length > 2 && team.limits.rounds > 1) {
      // the next round starts again from the first speaker: go round above the moderator, not through them
      const last = speakers.at(-1)!, first = speakers[0], over = nodes[0].y - R - 14;
      edges.push({ kind: 'turn', points: [[last.x, last.y - R - 3], [last.x, over], [first.x, over], [first.x, first.y - R - 5]], from: last.id, to: first.id });
    }
    // what each says goes to the moderator through the middle of the circle, so no line passes another speaker
    speakers.forEach((s) => {
      const [start] = trim(s, { ...s, x: c.x, y: c.y }, R + 3, 0);
      edges.push({ kind: 'report', points: [start, [c.x, c.y], [c.x, nodes[0].y + R + LABEL_H - 8]], from: s.id, to: nodes[0].id });
    });
    height = c.y + ry + LABEL_H + 12;
  }
  const kinds = [...new Set(edges.map((e) => e.kind))];
  return { nodes, edges, height, kinds };
}
