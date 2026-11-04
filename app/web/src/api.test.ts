import { expect, it } from 'vitest';
import { readSse } from './api.ts';

it('reads SSE events split across chunks', async () => {
  const parts = ['id: 0\ndata: {"type":"A"}\n\nid: 1\nda', 'ta: {"type":"B","x":1}\n', '\n'];
  const body = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
  const got: unknown[] = [];
  await readSse(new Response(body), (e) => got.push(e));
  expect(got).toEqual([{ type: 'A' }, { type: 'B', x: 1 }]);
});
