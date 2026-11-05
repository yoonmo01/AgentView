import type { AgentDef, ModelConn, ToolInfo } from '../api.ts';

export const DEFAULT_IMAGE = 'agentview/sandbox:base';
const COLORS = ['#e8805a', '#f2a65a', '#e9c46a', '#8cc084', '#4fb3a9', '#5b9bd5', '#6c7fd8', '#a084dc', '#e07ba0', '#c97b63', '#7d8597', '#3d5a80'];

/** An id from the name (lowercase letters, digits, -), unique among `taken`; Korean-only names become agent-2, agent-3, … */
export function idFor(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'agent';
  if (!taken.includes(base) && base !== 'agent') return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

/** A new agent that only needs a name and a role: the first model connection, every built-in tool, the base sandbox, a free color. */
export function newAgent(name: string, role: string, existing: AgentDef[], models: ModelConn[], tools: ToolInfo[]): AgentDef {
  const used = new Set(existing.map((a) => a.avatar.color));
  return {
    id: idFor(name, existing.map((a) => a.id)), name, role, connection: models[0]?.id ?? '', model: '', systemPrompt: '',
    tools: tools.filter((t) => !t.server).map((t) => t.name), maxSteps: 6,
    sandbox: { image: DEFAULT_IMAGE, network: false },
    avatar: { model: 'default.glb', color: COLORS.find((c) => !used.has(c)) ?? COLORS[existing.length % COLORS.length] },
  };
}
