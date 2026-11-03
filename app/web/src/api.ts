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
/** Mirrors the server's Team. Members are agent ids or `team:<id>`. */
export type TeamDef = {
  id: string;
  name: string;
  pattern: 'supervisor' | 'parallel' | 'debate';
  main: string;
  members: string[];
  limits: { maxDepth: number; maxCalls: number; timeoutSec: number; rounds: number };
  room: number | null;
};
export const PATTERN_LABEL: Record<TeamDef['pattern'], string> = { supervisor: '메인-하위', parallel: '병렬 분담', debate: '토론' };
export type ModelConn ={ id: string; baseURL: string; defaultModel?: string; maxTokens?: number };
/** `server` is null for the built-in sandbox tools, else the MCP server name. */
export type ToolInfo = { name: string; description: string; server: string | null };

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
