import { expect, it } from 'vitest';
import { MAX_GAP_MS, replayTimes } from './useOffice.ts';

it('replays recorded gaps at the chosen speed, capping long waits', () => {
  expect(replayTimes([1000, 1100, 1600], 1)).toEqual([0, 100, 600]);
  expect(replayTimes([1000, 1100, 1600], 2)).toEqual([0, 50, 300]);
  expect(replayTimes([0, 60_000, 60_010], 1)).toEqual([0, MAX_GAP_MS, MAX_GAP_MS + 10]); // a minute-long model call
  expect(replayTimes([0, undefined, 200], 1)).toEqual([0, 0, 200]);
});
