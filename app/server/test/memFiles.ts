import { NotFound, type Files } from '../src/sandbox.ts';

/** Sandbox files kept in memory for tests: /work is per agent, /team/<id> is shared by its members. */
export function memFiles(): Files & { put: (agentId: string, file: string, content: string) => void } {
  const store = new Map<string, string>();
  const key = (agentId: string, p: string) => (p.startsWith('/team/') ? p : `${agentId}:${p}`);
  return {
    put: (agentId, file, content) => { store.set(key(agentId, file), content); },
    list: async (a, dir) => [...store.keys()]
      .flatMap((k) => (k.startsWith('/team/') ? [k] : k.startsWith(`${a.id}:`) ? [k.slice(a.id.length + 1)] : []))
      .filter((p) => p.startsWith(`${dir}/`)).sort(),
    read: async (a, file) => {
      const v = store.get(key(a.id, file));
      if (v === undefined) throw new NotFound(`no such file: ${file}`);
      return Buffer.from(v);
    },
    write: async (a, file, content) => { store.set(key(a.id, file), content); },
    zip: async () => Buffer.from('PK'),
  };
}
