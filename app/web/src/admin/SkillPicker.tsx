import type { AgentDef, SkillInfo } from '../api.ts';
import { TOOL_KO } from './toolNames.ts';

/** Tool names Claude Code / Codex skills use, and the AgentView tool that does the same. */
const SAME: Record<string, string> = {
  Read: 'sandbox_read_file', Write: 'sandbox_write_file', Edit: 'sandbox_edit_file', MultiEdit: 'sandbox_edit_file',
  Bash: 'sandbox_run', Grep: 'sandbox_search', Glob: 'sandbox_search', LS: 'sandbox_list_files', WebFetch: 'web_fetch',
};
/** The tools a skill needs that the agent has turned off (reading SKILL.md itself needs the read tool). */
export function missingTools(skill: SkillInfo, tools: string[]): string[] {
  const needed = new Set(['sandbox_read_file', ...skill.allowedTools.map((t) => SAME[t.replace(/\(.*\)$/, '')] ?? t)]);
  return [...needed].filter((t) => (t.startsWith('sandbox_') || t === 'web_fetch' || t.startsWith('mcp__')) && !tools.includes(t));
}

/** The agent's skills: tick the ones it may use; a warning shows when a skill needs a tool the agent does not have. */
export function SkillPicker({ form, skills, onChange }: { form: AgentDef; skills: SkillInfo[]; onChange: (skills: string[]) => void }) {
  const picked = form.skills ?? [];
  return (
    <fieldset className="skill-picker">
      <legend>스킬</legend>
      {!skills.length && <p className="muted small">아직 스킬이 없어요. 설정의 스킬 탭에서 만들거나 가져오세요.</p>}
      {skills.map((s) => {
        const on = picked.includes(s.id);
        const missing = on ? missingTools(s, form.tools) : [];
        return (
          <div key={s.id} className="skill-pick">
            <label className="check" title={s.description}>
              <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
              <b>{s.name}</b> <small>{s.description}</small>
            </label>
            {missing.length > 0 && <p className="warn">필요한 도구가 꺼져 있어요: {missing.map((t) => TOOL_KO[t] ?? t).join(', ')}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}
