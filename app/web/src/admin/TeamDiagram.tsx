import type { AgentDef, TeamDef } from '../api.ts';

type Node = { id: string; x: number; y: number; main?: boolean };
const W = 480;
const R = 15;

/**
 * How work flows in a team, drawn from its pattern: who hands work to whom.
 * supervisor: the lead hands tasks down and gets results back; parallel: everyone gets the request, the main merges;
 * debate: members speak clockwise around the moderator.
 */
export function TeamDiagram({ team, agents }: { team: TeamDef; agents: AgentDef[] }) {
  const members = team.members.filter((m) => !m.startsWith('team:'));
  const spread = (n: number, y: number) => Array.from({ length: n }, (_, i) => ({ x: W / 2 + (i - (n - 1) / 2) * Math.min(90, (W - 80) / Math.max(1, n - 1)), y }));
  let nodes: Node[];
  let arrows: [Node, Node, boolean?][]; // [from, to, dashed]
  let H = 150;
  if (team.pattern === 'debate') {
    const all = [team.main, ...members];
    const r = 52, c = { x: W / 2, y: 78 };
    nodes = all.map((id, k) => {
      const a = (k / all.length) * Math.PI * 2;
      return { id, x: c.x + Math.sin(a) * r * 1.6, y: c.y - Math.cos(a) * r, main: k === 0 };
    });
    const speakers = nodes.slice(1);
    // speaking order: each member to the next, and the last back to the first when there is another round
    arrows = speakers.slice(0, -1).map((n, i) => [n, speakers[i + 1]] as [Node, Node]);
    if (speakers.length > 2 && team.limits.rounds > 1) arrows.push([speakers.at(-1)!, speakers[0]]);
    arrows.push(...nodes.slice(1).map((n) => [n, nodes[0], true] as [Node, Node, boolean]));
    H = 160;
  } else if (team.pattern === 'parallel') {
    const req = { id: '', x: W / 2, y: 18 };
    const row = spread(members.length, 75).map((p, i) => ({ id: members[i], ...p }));
    const main = { id: team.main, x: W / 2, y: 132, main: true };
    nodes = [...row, main];
    arrows = [...row.map((n) => [req as Node, n] as [Node, Node]), ...row.map((n) => [n, main] as [Node, Node])];
    H = 165;
  } else {
    const main = { id: team.main, x: W / 2, y: 30, main: true };
    const row = spread(members.length, 112).map((p, i) => ({ id: members[i], ...p }));
    nodes = [main, ...row];
    arrows = row.flatMap((n) => [[main, n] as [Node, Node], [n, main, true] as [Node, Node, boolean]]);
  }
  const who = (id: string) => agents.find((a) => a.id === id);
  // trim each arrow to the circle edges, and bow the return arrow so the pair does not overlap
  const path = ([a, b, dashed]: [Node, Node, boolean?]) => {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const ra = a.id === '' ? 4 : R + 3, rb = R + 5;
    const p = { x: a.x + (dx / d) * ra, y: a.y + (dy / d) * ra }, q = { x: b.x - (dx / d) * rb, y: b.y - (dy / d) * rb };
    const bow = team.pattern === 'supervisor' ? (dashed ? 10 : -10) : 0;
    const m = { x: (p.x + q.x) / 2 - (dy / d) * bow, y: (p.y + q.y) / 2 + (dx / d) * bow };
    return `M${p.x},${p.y} Q${m.x},${m.y} ${q.x},${q.y}`;
  };
  return (
    <figure className="team-diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${team.name || '팀'} 구조 그림`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {team.pattern === 'parallel' && <text x={W / 2} y={10} textAnchor="middle" className="cap">요청</text>}
        {arrows.map((a, i) => <path key={i} d={path(a)} className={a[2] ? 'back' : 'go'} markerEnd="url(#arrow)" />)}
        {nodes.map((n) => {
          const a = who(n.id);
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`}>
              <circle r={R} fill={a?.avatar.color ?? '#bbb'} stroke={n.main ? '#c9a227' : '#fff'} strokeWidth={n.main ? 3 : 2} />
              <text y={4} textAnchor="middle" className="init">{(a?.name ?? n.id).slice(0, 1).toUpperCase()}</text>
              <text y={R + 13} textAnchor="middle" className="name">{n.main ? '★ ' : ''}{a?.name ?? n.id}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        {team.pattern === 'supervisor' ? '팀장이 일을 나눠 맡기고(실선) 결과를 돌려받아요(점선).'
          : team.pattern === 'parallel' ? '모두 같은 요청을 동시에 받고, 메인이 결과를 합쳐요.'
          : '사회자부터 시계방향으로 발언하고(실선), 사회자가 결론을 정리해요(점선).'}
      </figcaption>
    </figure>
  );
}
