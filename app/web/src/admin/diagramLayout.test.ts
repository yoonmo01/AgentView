import { expect, it } from 'vitest';
import type { TeamDef } from '../api.ts';
import { layoutDiagram, R, W, type Node } from './diagramLayout.ts';

const PATTERNS: TeamDef['pattern'][] = ['supervisor', 'parallel', 'debate', 'pipeline', 'review', 'vote'];
const team = (pattern: TeamDef['pattern'], n: number) =>
  ({ pattern, main: 'm', members: Array.from({ length: n }, (_, i) => `p${i}`), limits: { rounds: 2 } }) as Pick<TeamDef, 'pattern' | 'main' | 'members' | 'limits'>;

/** Distance from point to segment. */
function toSegment(px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

it('keeps every picture readable for every pattern and team size (1 to 12 members)', () => {
  for (const pattern of PATTERNS) for (let n = 1; n <= 12; n++) {
    const { nodes, edges, height, kinds } = layoutDiagram(team(pattern, n));
    const people = nodes.filter((x) => !x.hub);
    const where = `${pattern} with ${n}`;
    expect(people.length, where).toBe(n + 1);
    for (const p of people) {
      // inside the picture, name included
      expect(p.x - R >= 0 && p.x + R <= W && p.y - R >= 0 && p.y + R + 16 <= height, `${where}: ${p.id} out of bounds`).toBe(true);
    }
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      expect(Math.hypot(a.x - b.x, a.y - b.y), `${where}: ${a.id} and ${b.id} too close`).toBeGreaterThanOrEqual(2 * R + 24);
      // names sit under the circles: people on about the same height need room for both names
      if (Math.abs(a.y - b.y) < 24) expect(Math.abs(a.x - b.x), `${where}: names of ${a.id} and ${b.id} overlap`).toBeGreaterThanOrEqual(68);
    }
    for (const e of edges) {
      for (const p of e.points) expect(p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= height, `${where}: ${e.kind} leaves the picture`).toBe(true);
      // and never over anyone's name (the strip under each circle)
      for (let s = 0; s + 1 < e.points.length; s++) for (const o of people) {
        const [[ax, ay], [bx, by]] = [e.points[s], e.points[s + 1]];
        for (let t = 0; t <= 1; t += 0.02) {
          const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          const onName = Math.abs(x - o.x) < 30 && y > o.y + R + 2 && y < o.y + R + 16;
          expect(onName, `${where}: ${e.kind} ${e.from}→${e.to} runs over the name of ${o.id}`).toBe(false);
        }
      }
      // a connection never runs through someone it does not join
      const others: Node[] = people.filter((x) => x.id !== e.from && x.id !== e.to);
      for (let s = 0; s + 1 < e.points.length; s++) for (const o of others) {
        expect(toSegment(o.x, o.y, e.points[s], e.points[s + 1]), `${where}: ${e.kind} ${e.from}→${e.to} crosses ${o.id}`).toBeGreaterThan(R + 1);
      }
    }
    expect(kinds.length, where).toBeGreaterThan(0); // the legend has something to say
  }
});

it('uses the connection kinds that fit each pattern', () => {
  const kinds = (p: TeamDef['pattern']) => layoutDiagram(team(p, 3)).kinds.sort();
  expect(kinds('supervisor')).toEqual(['result', 'work']);
  expect(kinds('review')).toEqual(['fix', 'submit']);
  expect(kinds('parallel')).toEqual(['input', 'merge']);
  expect(kinds('vote')).toEqual(['input', 'merge']);
  expect(kinds('pipeline')).toEqual(['handoff']);
  expect(kinds('debate')).toEqual(['report', 'turn']);
});
