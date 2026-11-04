/** Mirrors the server's Agent (server/src/store.ts). */
export type AgentDef = {
  id: string;
  name: string;
  role: string;
  connection: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  sandbox: { image: string; network: boolean };
  avatar: { model: string; color: string };
  maxSteps: number;
};
export type ModelConn = { id: string; baseURL: string; defaultModel?: string; maxTokens?: number };
export type ToolInfo = { name: string; description: string };

/** Read an SSE response body (POST /agui answers with one; EventSource can only GET). */
export async function readSse(res: Response, onEvent: (e: { type: string; [key: string]: any }) => void): Promise<void> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let end;
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const data = buf.slice(0, end).split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      buf = buf.slice(end + 2);
      if (data) onEvent(JSON.parse(data));
    }
  }
}

/** JSON call to the server through the Vite /api proxy. Throws with the server's message on failure. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => null);
    throw new Error(b?.message ?? b?.error ?? `HTTP ${res.status}`); // Fastify schema errors carry `message`
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
