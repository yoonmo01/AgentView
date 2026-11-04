import { expect, it } from 'vitest';
import { dayGroup, shortTime } from './dates.ts';

const now = new Date(2026, 10, 4, 15, 0).getTime(); // 2026-11-04 (Wed) 15:00 local
const at = (d: number, h = 13, m = 29) => new Date(2026, 10, d, h, m).toISOString();

it('groups sessions by day', () => {
  expect([at(4), at(3), at(1), new Date(2026, 9, 2).toISOString()].map((t) => dayGroup(t, now)))
    .toEqual(['오늘', '어제', '지난 7일', '2026년 10월']);
});

it('shows a time today and a date otherwise', () => {
  expect(shortTime(at(4), now)).toMatch(/오후\s*1:29/);
  expect(shortTime(at(3), now)).toMatch(/11월 3일.*화/);
  expect(shortTime(new Date(2025, 10, 3).toISOString(), now)).toMatch(/2025/);
});
