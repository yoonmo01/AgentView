import { expect, it } from 'vitest';
import type { AgentDef, TeamDef } from '../api.ts';
import { LOBBY_DESKS, placeAgents, roomDesks } from './layout.ts';

const agent = (id: string) => ({ id }) as AgentDef;
const team = (id: string, room: number | null, main: string, members: string[]) => ({ id, room, main, members }) as TeamDef;

it('seats team members in their room, the rest in the lobby', () => {
  const agents = ['atlas', 'nova', 'milo', 'solo'].map(agent);
  const places = placeAgents(agents, [
    team('b-team', 2, 'milo', ['nova', 'team:a-team']),
    team('a-team', 1, 'atlas', ['nova']), // nova's first team by id is a-team
    team('full', null, 'solo', []),
  ]);
  expect(places.get('atlas')).toEqual({ desk: roomDesks(1)[0], room: 1 });
  expect(places.get('nova')).toEqual({ desk: roomDesks(1)[1], room: 1 });
  expect(places.get('milo')).toEqual({ desk: roomDesks(2)[0], room: 2 });
  expect(places.get('solo')).toEqual({ desk: LOBBY_DESKS[0], room: null });
});

it('sends members past the room capacity to the lobby', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const places = placeAgents(ids.map(agent), [team('big', 3, 'a', ids.slice(1))]);
  expect(ids.map((id) => places.get(id)!.room)).toEqual([3, 3, 3, 3, null]);
});
