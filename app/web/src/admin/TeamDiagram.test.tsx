import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { AgentDef, TeamDef } from '../api.ts';
import { TeamDiagram } from './TeamDiagram.tsx';

const agents = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), avatar: { color: '#888888' } }) as AgentDef);
const draw = (pattern: TeamDef['pattern']) => renderToStaticMarkup(
  <TeamDiagram team={{ id: 't', name: 'T', pattern, main: 'a', members: ['b', 'c'], limits: { rounds: 2 } } as TeamDef} agents={agents} />);
const count = (html: string, cls: string) => html.split(`class="${cls}"`).length - 1;

it('draws each pattern with its own flow', () => {
  const line = draw('pipeline');
  expect(count(line, 'go')).toBe(2); // b → c → a
  expect(count(line, 'back')).toBe(0);
  const rev = draw('review');
  expect([count(rev, 'go'), count(rev, 'back')]).toEqual([2, 2]); // work up, fixes back
  expect(rev).toContain('수정 요청');
  const vote = draw('vote');
  expect(vote).toContain('같은 문제');
  expect(count(vote, 'go')).toBe(4); // problem → each member → judge
});
