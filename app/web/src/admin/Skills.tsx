import { useEffect, useState, type FormEvent } from 'react';
import { api, type SkillInfo, type ToolInfo } from '../api.ts';
import { ask } from '../shell/ask.ts';
import { Markdown } from '../chat/Markdown.tsx';
import { idFor } from './newAgent.ts';
import { TOOL_KO } from './toolNames.ts';

type Form = { id: string; name: string; description: string; allowedTools: string[]; body: string; source: string; files: string[] };
const EMPTY: Form = { id: '', name: '', description: '', allowedTools: [], body: '', source: 'local', files: [] };

/**
 * Skills: procedures, rules and knowledge an agent reads when a job calls for it (SKILL.md, the same format as
 * Claude Code and Codex). Made here, or copied from a GitHub folder; copied ones are read-only.
 */
export function Skills() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [preview, setPreview] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const fail = (e: unknown) => setMsg({ text: (e as Error).message, error: true });
  const reload = () => api<SkillInfo[]>('/skills').then(setSkills).catch(fail);
  useEffect(() => { void reload(); api<ToolInfo[]>('/tools').then(setTools).catch(() => {}); }, []);

  const open = async (s: SkillInfo | null) => {
    setMsg(null); setPreview(false); setIsNew(!s);
    if (!s) return setForm(EMPTY);
    try { setForm(await api<Form>(`/skills/${s.id}`)); } catch (e) { fail(e); }
  };
  const set = (patch: Partial<Form>) => setForm((f) => f && { ...f, ...patch });
  const readOnly = !!form && form.source !== 'local';

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const id = isNew ? form.id || idFor(form.name, skills.map((s) => s.id)) : form.id;
    try {
      const saved = await api<Form>(`/skills/${id}`, { method: 'PUT', body: { name: form.name, description: form.description, allowedTools: form.allowedTools, body: form.body } });
      setForm(saved); setIsNew(false); setMsg({ text: '저장했어요.' });
      await reload();
    } catch (err) { fail(err); }
  }

  async function copyIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const s = await api<Form>('/skills/import', { method: 'POST', body: { url: importUrl.trim() } });
      setImportUrl(''); setForm(s); setIsNew(false); setMsg({ text: `${s.name} 스킬을 가져왔어요.` });
      await reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  async function remove() {
    if (!form || !(await ask(`${form.name} 스킬을 지울까요? 이 스킬을 고른 에이전트에게서도 빠져요.`))) return;
    try { await api(`/skills/${form.id}`, { method: 'DELETE' }); setForm(null); await reload(); } catch (err) { fail(err); }
  }

  return (
    <div className="admin">
      <aside>
        <h2>스킬</h2>
        <ul className="rows">
          {skills.map((s) => (
            <li key={s.id}>
              <button aria-pressed={form?.id === s.id && !isNew} onClick={() => void open(s)}>
                <span className="row-text"><b>{s.name}</b><small>{s.source === 'local' ? '직접 만듦' : '가져옴'} · {s.description}</small></span>
              </button>
            </li>
          ))}
        </ul>
        <button className="add" onClick={() => void open(null)}>+ 새 스킬</button>
        <form className="import" onSubmit={copyIn}>
          <small>GitHub에서 가져오기</small>
          <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://github.com/…/tree/main/skills/이름" />
          <button type="submit" disabled={!importUrl.trim() || busy}>{busy ? '가져오는 중…' : '가져오기'}</button>
        </form>
      </aside>

      <section>
        {msg && <p className={msg.error ? 'error' : 'ok'} role="status">{msg.text}</p>}
        {!form ? (
          <div className="empty-note">
            <p>스킬은 에이전트가 특정 일을 할 때 따르는 <b>절차·규칙·지식</b>이에요. 에이전트 설정에서 고르면, 일이 맞을 때 에이전트가 스스로 읽고 따라요.</p>
            <p>왼쪽에서 고르거나 새로 만들거나 GitHub 폴더 주소로 가져오세요.</p>
          </div>
        ) : (
          <form onSubmit={save} className="form">
            <h2>{isNew ? '새 스킬' : form.name}</h2>
            {readOnly && <p className="muted small">가져온 스킬이라 여기서 고칠 수 없어요. 출처: <a href={form.source} target="_blank" rel="noreferrer">{form.source}</a></p>}
            <div className="row">
              <label>이름<input required maxLength={80} value={form.name} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} /></label>
              <label>ID{isNew && ' · 비우면 이름으로 자동'}
                <input pattern="[a-z0-9][a-z0-9\-]{0,60}" value={form.id} disabled={!isNew} placeholder={isNew ? idFor(form.name, skills.map((s) => s.id)) : undefined} onChange={(e) => set({ id: e.target.value })} />
              </label>
            </div>
            <label>한 줄 설명 (에이전트가 보고 쓸지 판단해요)
              <input maxLength={1000} value={form.description} disabled={readOnly} placeholder="예: 파이썬 코드를 체크리스트로 리뷰할 때" onChange={(e) => set({ description: e.target.value })} />
            </label>
            <fieldset>
              <legend>필요한 도구 (이 스킬을 쓰는 에이전트에게 켜져 있어야 해요)</legend>
              {readOnly ? <p className="muted small">{form.allowedTools.join(', ') || '없음'}</p> : tools.map((t) => (
                <label key={t.name} className="check">
                  <input type="checkbox" checked={form.allowedTools.includes(t.name)}
                    onChange={(e) => set({ allowedTools: e.target.checked ? [...form.allowedTools, t.name] : form.allowedTools.filter((x) => x !== t.name) })} />
                  {t.server ? `${t.server} · ${t.name.split('__').pop()}` : TOOL_KO[t.name] ?? t.name}
                </label>
              ))}
            </fieldset>
            <div className="skill-body">
              <div className="skill-body-head">
                <span>본문 (절차·규칙·지식, 마크다운)</span>
                {!readOnly && <button type="button" onClick={() => setPreview(!preview)}>{preview ? '편집' : '미리보기'}</button>}
              </div>
              {readOnly || preview ? <Markdown text={form.body} className="skill-preview" />
                : <textarea rows={14} value={form.body} placeholder={'1. 먼저 …를 확인한다\n2. …'} onChange={(e) => set({ body: e.target.value })} />}
            </div>
            {form.files.length > 1 && <p className="muted small">스킬 폴더 파일: {form.files.join(', ')}</p>}
            <div className="actions">
              {!readOnly && <button className="primary" type="submit">저장</button>}
              {!isNew && <button type="button" className="danger" onClick={() => void remove()}>삭제</button>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
