import { expect, it } from 'vitest';
import type { AgentDef, TeamDef } from '../api.ts';
import { assignLobby, roomDesks, teamSeats } from './layout.ts';

const agent = (id: string) => ({ id }) as AgentDef;
const team = (id: string, room: number | null, main: string, members: string[]) => ({ id, room, main, members }) as TeamDef;

it('gives every member an own desk per team, main first', () => {
  const seats = teamSeats(['atlas', 'nova', 'milo'].map(agent), [
    team('dev', 1, 'atlas', ['nova', 'team:x']),
    team('talk', 2, 'milo', ['nova', 'atlas']), // nova has a seat in both rooms
    team('none', null, 'milo', []),
  ]);
  expect([...seats.get('dev')!]).toEqual([['atlas', roomDesks(1)[0]], ['nova', roomDesks(1)[1]]]);
  expect(seats.get('talk')!.get('nova')).toEqual(roomDesks(2)[1]);
  expect(seats.get('none')!.size).toBe(0);
});

it('keeps lobby desks stable and lets extra solo workers wait', () => {
  let m = assignLobby(new Map(), ['a', 'b', 'c'], 2);
  expect([...m]).toEqual([['a', 0], ['b', 1]]); // c waits
  m = assignLobby(m, ['b', 'c']); // a finished: c takes the freed desk, b stays put
  expect([...m]).toEqual([['b', 1], ['c', 0]]);
});
