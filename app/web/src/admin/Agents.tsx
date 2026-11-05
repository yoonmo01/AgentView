import { useEffect, useState, type FormEvent } from 'react';
import { ModelPicker } from '../chat/ModelPicker.tsx';
import { api, type AgentDef, type ModelConn, type PluginState, type SkillInfo, type ToolInfo } from '../api.ts';
import { PluginPicker } from './PluginPicker.tsx';
import { Avatar } from '../shell/ui.tsx';
import { ask } from '../shell/ask.ts';
import { idFor, newAgent } from './newAgent.ts';
import { IdField } from './IdField.tsx';
import { SandboxEnv } from './SandboxEnv.tsx';
import { TOOL_HELP, TOOL_KO } from './toolNames.ts';
import { SkillPicker } from './SkillPicker.tsx';

/** Soft character colors; none is neon, and the last swatch opens a free color picker. */
const AVATAR_COLORS = ['#e8805a', '#f2a65a', '#e9c46a', '#8cc084', '#4fb3a9', '#5b9bd5', '#6c7fd8', '#a084dc', '#e07ba0', '#c97b63', '#7d8597', '#3d5a80'];


/** Agent list and form. `focus` opens that agent; `onChanged` lets the office reload after a save or delete. */
export function Agents({ focus, onChanged }: { focus?: string; onChanged?: () => void } = {}) {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [models, setModels] = useState<ModelConn[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginState['installed']>([]);
  const [form, setForm] = useState<AgentDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [saves, setSaves] = useState(0); // the sandbox build starts on save
  const [available, setAvailable] = useState<string[]>([]); // models of the picked connection
  useEffect(() => {
    if (!form?.connection) return;
    api<string[]>(`/models/${form.connection}/available`).then(setAvailable).catch(() => setAvailable([]));
  }, [form?.connection]);

  const fail = (e: unknown) => setMsg({ text: (e as Error).message, error: true });
  const reload = () => api<AgentDef[]>('/agents').then((list) => { setAgents(list); return list; });
  useEffect(() => {
    reload().then((list) => setForm(list.find((a) => a.id === focus) ?? null)).catch(fail);
    api<ModelConn[]>('/models').then(setModels).catch(fail);
    api<ToolInfo[]>('/tools').then(setTools).catch(fail);
    api<SkillInfo[]>('/skills').then(setSkills).catch(fail);
    api<PluginState>('/plugins').then((s) => setPlugins(s.installed)).catch(() => {});
  }, []);

  const set = (patch: Partial<AgentDef>) => setForm((f) => f && { ...f, ...patch });
  const open = (a: AgentDef | null) => {
    setForm(a ?? { ...newAgent('', '', agents, models, tools), id: '' });
    setIsNew(!a);
    setMsg(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      const body = { ...form, id: isNew && !form.id ? idFor(form.name, agents.map((a) => a.id)) : form.id };
      const saved = await api<AgentDef>(isNew ? '/agents' : `/agents/${form.id}`, { method: isNew ? 'POST' : 'PUT', body });
      setForm(saved);
      setIsNew(false);
      setMsg({ text: '저장했어요.' });
      setSaves((n) => n + 1);
      await reload();
      onChanged?.();
    } catch (err) { fail(err); }
  }

  async function remove() {
    if (!form || !(await ask(`${form.name} 에이전트를 지울까요?`))) return;
    const withFiles = await ask(`${form.name}의 작업 폴더도 지울까요? 지운 파일은 되돌릴 수 없어요.`, '폴더도 지우기', '폴더는 남기기');
    try {
      await api(`/agents/${form.id}${withFiles ? '?files=true' : ''}`, { method: 'DELETE' });
      setForm(null);
      await reload();
      onChanged?.();
    } catch (err) { fail(err); }
  }

  return (
    <div className="admin">
      <aside>
        <h2>에이전트</h2>
        <ul className="rows">
          {agents.map((a) => (
            <li key={a.id}>
              <button aria-pressed={form?.id === a.id && !isNew} onClick={() => open(a)}>
                <Avatar agent={a} /><span className="row-text"><b>{a.name}</b><small>{a.role}</small></span>
              </button>
            </li>
          ))}
        </ul>
        <button className="add" onClick={() => open(null)}>+ 새 에이전트</button>
      </aside>

      <section>
        {msg && <p className={msg.error ? 'error' : 'ok'} role="status">{msg.text}</p>}
        {!form ? <p>왼쪽에서 에이전트를 고르거나 새로 만드세요.</p> : (
          <form onSubmit={save} className="form">
            <h2>{isNew ? '새 에이전트' : form.name}</h2>
            {isNew && plugins.some((p) => p.agents.length) && (
              <label>플러그인 템플릿으로 채우기
                <select value="" onChange={(e) => {
                  const t = plugins.flatMap((p) => p.agents).find((a) => `${a.plugin}/${a.name}` === e.target.value);
                  if (t) set({ name: t.name, role: t.description.slice(0, 200), systemPrompt: t.prompt.slice(0, 20_000) });
                }}>
                  <option value="">템플릿 고르기…</option>
                  {plugins.flatMap((p) => p.agents).map((a) => <option key={`${a.plugin}/${a.name}`} value={`${a.plugin}/${a.name}`}>{a.plugin} · {a.name}</option>)}
                </select>
              </label>
            )}
            <div className="row">
              <label>이름<input required maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
              <label>역할<input maxLength={200} value={form.role} placeholder="예: 코딩 담당" onChange={(e) => set({ role: e.target.value })} /></label>
              <IdField label={isNew ? 'ID (비우면 자동)' : 'ID'} value={form.id} disabled={!isNew} placeholder={isNew ? idFor(form.name, agents.map((a) => a.id)) : undefined} onChange={(id) => set({ id })} />
            </div>
            <label>기본 지시문 (항상 적용)
              <textarea rows={6} value={form.systemPrompt} placeholder="혼자 일할 때도, 어느 팀에 있을 때도 맨 앞에 들어가는 성격과 규칙" onChange={(e) => set({ systemPrompt: e.target.value })} />
            </label>
            <div className="row">
              <label>모델 연결
                <select required value={form.connection} onChange={(e) => set({ connection: e.target.value })}>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              </label>
              {/* a div, not a label: a label would forward clicks on the list to the picker button */}
              <div className="field"><span>모델</span>
                <ModelPicker value={form.model} models={available} defaultModel={models.find((m) => m.id === form.connection)?.defaultModel ?? ''} down onChange={(model) => set({ model })} />
              </div>
              <label>최대 단계<input type="number" min={1} max={20} value={form.maxSteps} onChange={(e) => set({ maxSteps: Number(e.target.value) })} /></label>
            </div>
            {[...new Set(tools.map((t) => t.server))].map((server) => (
              <fieldset key={server ?? 'base'}>
                <legend>{server ? `외부 도구 (MCP) · ${server}` : '기본 도구 (샌드박스)'}</legend>
                {tools.filter((t) => t.server === server).map((t) => (
                  <label key={t.name} className="check" title={server ? t.description : TOOL_HELP[t.name] ?? t.description}>
                    <input type="checkbox" checked={form.tools.includes(t.name)}
                      onChange={(e) => set({ tools: e.target.checked ? [...form.tools, t.name] : form.tools.filter((x) => x !== t.name) })} />
                    {server ? t.name.slice(`mcp__${server}__`.length) : TOOL_KO[t.name] ?? t.name}
                  </label>
                ))}
              </fieldset>
            ))}
            <PluginPicker form={form} plugins={plugins} tools={tools} onChange={set} />
            <SkillPicker form={form} skills={skills} onChange={(s) => set({ skills: s })} />
            <SandboxEnv form={form} onSandbox={(sandbox) => set({ sandbox })} saved={isNew ? undefined : form.id} rev={saves} />
            <fieldset className="swatches">
              <legend>캐릭터 색</legend>
              {AVATAR_COLORS.map((c) => (
                <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={form.avatar.color === c}
                  aria-label={`색 ${c}`} onClick={() => set({ avatar: { ...form.avatar, color: c } })} />
              ))}
              <label className={`swatch custom${AVATAR_COLORS.includes(form.avatar.color) ? '' : ' on'}`} title="직접 고르기"
                style={AVATAR_COLORS.includes(form.avatar.color) ? undefined : { background: form.avatar.color }}>
                <input type="color" value={form.avatar.color} onChange={(e) => set({ avatar: { ...form.avatar, color: e.target.value } })} aria-label="색 직접 고르기" />
              </label>
            </fieldset>
            <div className="actions">
              <button className="primary" type="submit">저장</button>
              {!isNew && <button type="button" className="danger" onClick={remove}>삭제</button>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
