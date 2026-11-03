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
