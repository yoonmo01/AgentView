import { expect, it } from 'vitest';
import { idFor } from './newAgent.ts';

it('makes a unique id from the name', () => {
  expect(idFor('Data Bot', [])).toBe('data-bot');
  expect(idFor('Data Bot', ['data-bot'])).toBe('data-bot-2');
  expect(idFor('지원', ['agent-2'])).toBe('agent-3');
});
