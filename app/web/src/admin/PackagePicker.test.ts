import { expect, it } from 'vitest';
import { GROUPS, SETS } from './PackagePicker.tsx';

// the server's rules (server/src/sandbox.ts PKG): every listed package must pass them
const VALID = {
  pip: /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?([=<>!~]=?[A-Za-z0-9.*+-]+)?$/,
  npm: /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9.^~*+-]+)?$/,
  apt: /^[a-z0-9][a-z0-9+.-]*(=[A-Za-z0-9.:~+-]+)?$/,
};

it('lists only valid package names, and every set item is in the list', () => {
  const all = GROUPS.flatMap((g) => g.items);
  for (const p of all) expect(VALID[p.kind].test(p.name), p.name).toBe(true);
  for (const s of SETS) for (const name of s.items) expect(all.some((p) => p.name === name), name).toBe(true);
});
