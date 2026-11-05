import type { AgentDef, TeamDef } from '../api.ts';
import { KINDS, layoutDiagram, R, W } from './diagramLayout.ts';

const CAPTION: Record<TeamDef['pattern'], string> = {
  supervisor: '팀장이 일을 나눠 맡기고 결과를 돌려받아요.',
  parallel: '모두 같은 요청을 동시에 받아 각자 역할을 하고, 메인이 결과를 합쳐요.',
  debate: '사회자부터 시계방향으로 발언하고, 사회자가 결론을 정리해요.',
  pipeline: '차례로 일하며 결과를 다음 사람에게 넘기고, 마지막 사람이 최종 답을 써요.',
  review: '구성원이 결과물을 검토자에게 내고, 통과할 때까지 수정 요청을 받아 고쳐요.',
  vote: '모두 같은 문제를 서로 보지 않고 각자 풀고, 심판이 가장 좋은 답을 골라요.',
};
const short = (s: string) => (s.length > 6 ? `${s.slice(0, 5)}…` : s);

/** How work flows in a team, drawn by the rules in diagramLayout.ts, with a legend of the connection kinds it uses. */
export function TeamDiagram({ team, agents }: { team: TeamDef; agents: AgentDef[] }) {
  const { nodes, edges, height, kinds } = layoutDiagram(team);
  const who = (id: string) => agents.find((a) => a.id === id);
  return (
    <figure className="team-diagram">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${team.name || '팀'} 구조 그림`}>
        <defs>
          {kinds.map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={KINDS[k].color} />
            </marker>
          ))}
        </defs>
        {edges.map((e, i) => (
          <polyline key={i} points={e.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={KINDS[e.kind].color}
            strokeWidth={KINDS[e.kind].width} strokeDasharray={KINDS[e.kind].dash} strokeLinejoin="round" markerEnd={`url(#arrow-${e.kind})`} />
        ))}
        {nodes.map((n) => {
          if (n.hub) return (
            <g key="hub" transform={`translate(${n.x},${n.y})`}>
              <rect x={-36} y={-11} width={72} height={20} rx={10} className="hub" />
              <text y={4} textAnchor="middle" className="cap">{n.hub}</text>
            </g>
          );
          const a = who(n.id);
          const name = a?.name ?? n.id;
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`}>
              <title>{name}</title>
              <circle r={R} fill={a?.avatar.color ?? '#bbb'} stroke={n.main ? '#c9a227' : '#fff'} strokeWidth={n.main ? 3 : 2} />
              <text y={4} textAnchor="middle" className="init">{name.slice(0, 1).toUpperCase()}</text>
              <text y={R + 13} textAnchor="middle" className="name">{n.main ? '★ ' : ''}{short(name)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span>{CAPTION[team.pattern]}</span>
        <span className="legend">
          {kinds.map((k) => (
            <span key={k}>
              <svg width="26" height="8" aria-hidden><line x1="1" y1="4" x2="25" y2="4" stroke={KINDS[k].color} strokeWidth={KINDS[k].width} strokeDasharray={KINDS[k].dash} /></svg>
              {KINDS[k].label}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
