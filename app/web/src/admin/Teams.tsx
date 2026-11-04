import { useEffect, useState, type FormEvent } from 'react';
import { api, PATTERN_LABEL, type AgentDef, type TeamDef } from '../api.ts';

const EMPTY: TeamDef = {
  id: '', name: '', pattern: 'supervisor', main: '', members: [], room: null,
  limits: { maxDepth: 3, maxCalls: 50, timeoutSec: 600, rounds: 2 },
};
const HELP: Record<TeamDef['pattern'], string> = {
  supervisor: '메인이 delegate 도구로 구성원에게 일을 나눠 맡기고 결과를 받아 정리해요.',
  parallel: '모든 구성원이 같은 요청을 각자 역할로 동시에 처리하고, 메인이 결과를 합쳐요.',
  debate: '구성원이 라운드마다 차례로 발언하고, 메인(사회자)이 결론을 정리해요.',
};

export function Teams({ focus, onChanged }: { focus?: string; onChanged?: () => void } = {}) {
  const [teams, setTeams] = useState<TeamDef[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [form, setForm] = useState<TeamDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const fail = (e: unknown) => setMsg({ text: (e as Error).message, error: true });
  const reload = () => api<TeamDef[]>('/teams').then((list) => { setTeams(list); return list; });
  useEffect(() => {
    reload().then((list) => setForm(list.find((t) => t.id === focus) ?? null)).catch(fail);
    api<AgentDef[]>('/agents').then(setAgents).catch(fail);
  }, []);

  const set = (patch: Partial<TeamDef>) => setForm((f) => f && { ...f, ...patch });
  const setLimit = (k: keyof TeamDef['limits'], v: number) => setForm((f) => f && { ...f, limits: { ...f.limits, [k]: v } });
  const open = (t: TeamDef | null) => { setForm(t ?? { ...EMPTY, main: agents[0]?.id ?? '' }); setIsNew(!t); setMsg(null); };
  const candidates = form ? [
    ...agents.filter((a) => a.id !== form.main).map((a) => ({ value: a.id, label: `${a.name} (${a.role || a.id})` })),
    ...teams.filter((t) => t.id !== form.id).map((t) => ({ value: `team:${t.id}`, label: `${t.name} 팀` })),
  ] : [];

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      const saved = await api<TeamDef>(isNew ? '/teams' : `/teams/${form.id}`, { method: isNew ? 'POST' : 'PUT', body: form });
      setForm(saved);
      setIsNew(false);
      setMsg({ text: saved.room ? `저장했어요. ${saved.room}번 방을 배정했어요.` : '저장했어요. 빈 방이 없어서 구성원은 로비에 앉아요.' });
      await reload();
      onChanged?.();
    } catch (err) { fail(err); }
  }

  async function remove() {
    if (!form || !confirm(`${form.name} 팀을 지울까요? 방이 비고, 공유 폴더 파일은 남아요.`)) return;
    try {
      await api(`/teams/${form.id}`, { method: 'DELETE' });
      setForm(null);
      await reload();
      onChanged?.();
    } catch (err) { fail(err); }
  }

  return (
    <div className="admin">
      <aside>
        <h2>팀</h2>
        <ul className="list">
          {teams.map((t) => (
            <li key={t.id}>
              <button aria-pressed={form?.id === t.id && !isNew} onClick={() => open(t)}>
                {t.name} <small>{PATTERN_LABEL[t.pattern]} · {t.room ? `${t.room}번 방` : '로비'}</small>
              </button>
            </li>
          ))}
        </ul>
        <button className="primary" onClick={() => open(null)} disabled={!agents.length}>+ 새 팀</button>
      </aside>

      <section>
        {msg && <p className={msg.error ? 'error' : 'ok'} role="status">{msg.text}</p>}
        {!form ? <p>왼쪽에서 팀을 고르거나 새로 만드세요.</p> : (
          <form onSubmit={save} className="form">
            <h2>{isNew ? '새 팀' : `${form.name}${form.room ? ` · ${form.room}번 방` : ''}`}</h2>
            <label>ID (영문 소문자·숫자·-)
              <input required pattern="[a-z0-9][a-z0-9\-]{0,40}" value={form.id} disabled={!isNew} onChange={(e) => set({ id: e.target.value })} />
            </label>
            <label>이름<input required maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label>구조
              <select value={form.pattern} onChange={(e) => set({ pattern: e.target.value as TeamDef['pattern'] })}>
                {Object.entries(PATTERN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <small>{HELP[form.pattern]}</small>
            </label>
            <label>{form.pattern === 'debate' ? '사회자 (메인)' : '메인 에이전트'}
              <select required value={form.main} onChange={(e) => set({ main: e.target.value, members: form.members.filter((m) => m !== e.target.value) })}>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <fieldset>
              <legend>구성원 {form.pattern === 'debate' && '(발언 순서대로 체크)'}</legend>
              {candidates.map((c) => (
                <label key={c.value} className="check">
                  <input type="checkbox" checked={form.members.includes(c.value)}
                    onChange={(e) => set({ members: e.target.checked ? [...form.members, c.value] : form.members.filter((m) => m !== c.value) })} />
                  {c.label}
                </label>
              ))}
            </fieldset>
            <div className="row">
              {form.pattern === 'debate' && (
                <label>라운드 (1~5)<input type="number" min={1} max={5} value={form.limits.rounds} onChange={(e) => setLimit('rounds', Number(e.target.value))} /></label>
              )}
              <label>모델 호출 한도 (1~200)<input type="number" min={1} max={200} value={form.limits.maxCalls} onChange={(e) => setLimit('maxCalls', Number(e.target.value))} /></label>
              <label>중첩 깊이 (1~5)<input type="number" min={1} max={5} value={form.limits.maxDepth} onChange={(e) => setLimit('maxDepth', Number(e.target.value))} /></label>
              <label>시간 제한 (초)<input type="number" min={10} max={3600} value={form.limits.timeoutSec} onChange={(e) => setLimit('timeoutSec', Number(e.target.value))} /></label>
            </div>
            <div className="actions">
              <button className="primary" type="submit" disabled={!form.members.length}>저장</button>
              {!isNew && <button type="button" className="danger" onClick={remove}>삭제</button>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
