import { useEffect, useState, type FormEvent } from 'react';
import { api, type AgentDef, type ModelConn, type ToolInfo } from '../api.ts';

const EMPTY: AgentDef = {
  id: '', name: '', role: '', connection: '', model: '', systemPrompt: '', tools: [], maxSteps: 6,
  sandbox: { image: 'agentview/sandbox:base', network: false }, avatar: { model: 'default.glb', color: '#5b8def' },
};

export function Agents() {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [models, setModels] = useState<ModelConn[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [form, setForm] = useState<AgentDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const fail = (e: unknown) => setMsg({ text: (e as Error).message, error: true });
  const reload = () => api<AgentDef[]>('/agents').then((list) => { setAgents(list); return list; });
  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('agent');
    reload().then((list) => setForm(list.find((a) => a.id === wanted) ?? null)).catch(fail);
    api<ModelConn[]>('/models').then(setModels).catch(fail);
    api<ToolInfo[]>('/tools').then(setTools).catch(fail);
  }, []);

  const set = (patch: Partial<AgentDef>) => setForm((f) => f && { ...f, ...patch });
  const open = (a: AgentDef | null) => { setForm(a ?? { ...EMPTY, connection: models[0]?.id ?? '' }); setIsNew(!a); setMsg(null); };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      const saved = await api<AgentDef>(isNew ? '/agents' : `/agents/${form.id}`, { method: isNew ? 'POST' : 'PUT', body: form });
      setForm(saved);
      setIsNew(false);
      setMsg({ text: '저장했어요.' });
      await reload();
    } catch (err) { fail(err); }
  }

  async function remove() {
    if (!form || !confirm(`${form.name} 에이전트를 지울까요? 작업 파일은 남아요.`)) return;
    try {
      await api(`/agents/${form.id}`, { method: 'DELETE' });
      setForm(null);
      await reload();
    } catch (err) { fail(err); }
  }

  return (
    <div className="admin">
      <aside>
        <h2>에이전트</h2>
        <ul className="list">
          {agents.map((a) => (
            <li key={a.id}>
              <button aria-pressed={form?.id === a.id && !isNew} onClick={() => open(a)}>
                <span className="dot" style={{ background: a.avatar.color }} /> {a.name} <small>{a.role}</small>
              </button>
            </li>
          ))}
        </ul>
        <button className="primary" onClick={() => open(null)}>+ 새 에이전트</button>
        <h2>모델 연결</h2>
        <ul className="plain">
          {models.map((m) => <li key={m.id}><b>{m.id}</b> · {m.defaultModel ?? '모델 미지정'}<br /><small>{m.baseURL}</small></li>)}
        </ul>
      </aside>

      <section>
        {msg && <p className={msg.error ? 'error' : 'ok'} role="status">{msg.text}</p>}
        {!form ? <p>왼쪽에서 에이전트를 고르거나 새로 만드세요.</p> : (
          <form onSubmit={save} className="form">
            <h2>{isNew ? '새 에이전트' : form.name}</h2>
            <label>ID (영문 소문자·숫자·-)
              <input required pattern="[a-z0-9][a-z0-9\-]{0,40}" value={form.id} disabled={!isNew} onChange={(e) => set({ id: e.target.value })} />
            </label>
            <label>이름<input required maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label>역할<input maxLength={200} value={form.role} onChange={(e) => set({ role: e.target.value })} /></label>
            <label>지시문 (system prompt)
              <textarea rows={6} value={form.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} />
            </label>
            <div className="row">
              <label>모델 연결
                <select required value={form.connection} onChange={(e) => set({ connection: e.target.value })}>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              </label>
              <label>모델 (비우면 연결 기본값)
                <input value={form.model} placeholder={models.find((m) => m.id === form.connection)?.defaultModel}
                  onChange={(e) => set({ model: e.target.value })} />
              </label>
              <label>최대 단계<input type="number" min={1} max={20} value={form.maxSteps} onChange={(e) => set({ maxSteps: Number(e.target.value) })} /></label>
            </div>
            {[...new Set(tools.map((t) => t.server))].map((server) => (
              <fieldset key={server ?? 'base'}>
                <legend>{server ? `MCP 도구 · ${server}` : '기본 도구 (샌드박스)'}</legend>
                {tools.filter((t) => t.server === server).map((t) => (
                  <label key={t.name} className="check" title={t.description}>
                    <input type="checkbox" checked={form.tools.includes(t.name)}
                      onChange={(e) => set({ tools: e.target.checked ? [...form.tools, t.name] : form.tools.filter((x) => x !== t.name) })} />
                    {server ? t.name.slice(`mcp__${server}__`.length) : t.name}
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="row">
              <label>샌드박스 이미지
                <input value={form.sandbox.image} onChange={(e) => set({ sandbox: { ...form.sandbox, image: e.target.value } })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={form.sandbox.network} onChange={(e) => set({ sandbox: { ...form.sandbox, network: e.target.checked } })} />
                샌드박스 인터넷 허용
              </label>
              <label>캐릭터 색
                <input type="color" value={form.avatar.color} onChange={(e) => set({ avatar: { ...form.avatar, color: e.target.value } })} />
              </label>
            </div>
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
