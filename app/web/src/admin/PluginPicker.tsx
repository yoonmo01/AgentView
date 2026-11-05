import type { AgentDef, InstalledPlugin, ToolInfo } from '../api.ts';

/** The skill ids and MCP tool names a plugin brought in. */
export function pluginParts(p: InstalledPlugin, tools: ToolInfo[]): { skills: string[]; tools: string[] } {
  return { skills: p.skills, tools: tools.filter((t) => t.server && p.mcp.includes(t.server)).map((t) => t.name) };
}

/**
 * Turn a whole plugin on or off for the agent: ticks or unticks all of its skills and external tools at once.
 * The skills and tools lists show the result, so nothing is hidden behind the plugin switch.
 */
export function PluginPicker({ form, plugins, tools, onChange }: {
  form: AgentDef; plugins: InstalledPlugin[]; tools: ToolInfo[]; onChange: (patch: Pick<AgentDef, 'skills' | 'tools'>) => void;
}) {
  const usable = plugins.filter((p) => p.skills.length || p.mcp.length);
  if (!usable.length) return null;
  return (
    <fieldset>
      <legend>플러그인 (켜면 그 플러그인의 스킬과 외부 도구가 한꺼번에 켜져요)</legend>
      {usable.map((p) => {
        const parts = pluginParts(p, tools);
        const skills = form.skills ?? [];
        const on = parts.skills.every((s) => skills.includes(s)) && parts.tools.every((t) => form.tools.includes(t));
        return (
          <label key={p.name} className="check" title={p.description}>
            <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked
              ? { skills: [...new Set([...skills, ...parts.skills])], tools: [...new Set([...form.tools, ...parts.tools])] }
              : { skills: skills.filter((s) => !parts.skills.includes(s)), tools: form.tools.filter((t) => !parts.tools.includes(t)) })} />
            <b>{p.name}</b> <small className="muted">스킬 {parts.skills.length} · 외부 도구 {parts.tools.length}</small>
          </label>
        );
      })}
    </fieldset>
  );
}
