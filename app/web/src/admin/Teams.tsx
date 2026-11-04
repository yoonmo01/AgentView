import { useEffect, useState, type FormEvent } from 'react';
import { api, PATTERN_LABEL, type AgentDef, type TeamDef } from '../api.ts';
import { Avatar, TeamMark } from '../shell/ui.tsx';
import { TeamDiagram } from './TeamDiagram.tsx';
import { ask } from '../shell/ask.ts';

/** Same palette as the server's TEAM_COLORS: none of them looks like a status color. */
const TEAM_COLORS = ['#8a5cd6', '#1aa3a3', '#d6589c', '#3f51b5', '#9c6b3f', '#7a8f2a', '#5d6d7e', '#6d4c8f'];

const EMPTY: TeamDef = {
  id: '', name: '', pattern: 'supervisor', main: '', members: [], room: null, color: '', roles: {},
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
  const move = (from: number, to: number) => setForm((f) => {
    if (!f || to < 0 || to >= f.members.length || from === to) return f;
    const members = [...f.members];
    members.splice(to, 0, ...members.splice(from, 1));
    return { ...f, members };
  });
  const setLimit = (k: keyof TeamDef['limits'], v: number) => setForm((f) => f && { ...f, limits: { ...f.limits, [k]: v } });
  const open = (t: TeamDef | null) => { setForm(t ?? { ...EMPTY, main: agents[0]?.id ?? '' }); setIsNew(!t); setMsg(null); };
  const candidates = form ? [
    ...agents.filter((a) => a.id !== form.main).map((a) => ({ value: a.id, label: a.name, note: a.role, mark: <Avatar agent={a} /> })),
    // ponytail: teams inside teams stay possible on the server but are hidden here until that feature is designed
  ] : [];

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      const saved = await api<TeamDef>(isNew ? '/teams' : `/teams/${form.id}`, { method: isNew ? 'POST' : 'PUT', body: form });
      setForm(saved);
      setIsNew(false);
      setMsg({ text: '저장했어요. 오피스의 팀 방도 구성에 맞게 바뀌어요.' });
      await reload();
      onChanged?.();
    } catch (err) { fail(err); }
  }

  async function remove() {
    if (!form || !(await ask(`${form.name} 팀을 지울까요? 방이 비고, 공유 폴더 파일은 남아요.`))) return;
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
        <ul className="rows">
          {teams.map((t) => (
            <li key={t.id}>
              <button aria-pressed={form?.id === t.id && !isNew} onClick={() => open(t)}>
                <TeamMark team={t} /><span className="row-text"><b>{t.name}</b><small>{PATTERN_LABEL[t.pattern]} · {t.members.length + 1}명</small></span>
              </button>
            </li>
          ))}
        </ul>
        <button className="add" onClick={() => open(null)} disabled={!agents.length}>+ 새 팀</button>
      </aside>

      <section>
        {msg && <p className={msg.error ? 'error' : 'ok'} role="status">{msg.text}</p>}
        {!form ? <p>왼쪽에서 팀을 고르거나 새로 만드세요.</p> : (
          <form onSubmit={save} className="form">
            <h2>{isNew ? '새 팀' : form.name}</h2>
            <TeamDiagram team={form} agents={agents} />
            <label>ID (영문 소문자·숫자·-)
              <input required pattern="[a-z0-9][a-z0-9\-]{0,40}" value={form.id} disabled={!isNew} onChange={(e) => set({ id: e.target.value })} />
            </label>
            <label>이름<input required maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <fieldset className="swatches">
              <legend>팀 색 {!form.color && <small>(저장하면 다른 팀과 겹치지 않는 색이 정해져요)</small>}</legend>
              {TEAM_COLORS.map((c) => (
                <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={form.color === c}
                  aria-label={`색 ${c}`} onClick={() => set({ color: c })} />
              ))}
            </fieldset>
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
            <fieldset className="order">
              <legend>{form.pattern === 'debate' ? '발언 순서' : '구성원'}</legend>
              {/* the array order is the speaking order: move with the arrows or by dragging a row */}
              <ol>
                {form.members.map((m, i) => {
                  const c = candidates.find((x) => x.value === m);
                  return (
                    <li key={m} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); move(Number(e.dataTransfer.getData('text/plain')), i); }}>
                      <span className="num">{i + 1}</span>{c?.mark}<b>{c?.label ?? m}</b><small>{c?.note}</small>
                      <button type="button" className="icon" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`${c?.label ?? m} 위로`}>↑</button>
                      <button type="button" className="icon" onClick={() => move(i, i + 1)} disabled={i === form.members.length - 1} aria-label={`${c?.label ?? m} 아래로`}>↓</button>
                      <button type="button" className="icon" onClick={() => set({ members: form.members.filter((x) => x !== m) })} aria-label={`${c?.label ?? m} 빼기`}>✕</button>
                    </li>
                  );
                })}
              </ol>
              {!form.members.length && <p className="muted small">아래에서 구성원을 추가하세요.</p>}
              {candidates.some((c) => !form.members.includes(c.value)) && (
                <div className="add-chips">
                  <small>추가</small>
                  {candidates.filter((c) => !form.members.includes(c.value)).map((c) => (
                    <button key={c.value} type="button" onClick={() => set({ members: [...form.members, c.value] })}>{c.mark} {c.label}</button>
                  ))}
                </div>
              )}
            </fieldset>
            <fieldset className="roles">
              <legend>팀에서의 역할과 지시</legend>
              <small>이 팀으로 일할 때만 쓰여요. 비워 두면 에이전트 설정의 역할과 지시문을 그대로 써요. 혼자 일할 때는 쓰이지 않아요.</small>
              {[form.main, ...form.members].filter((id) => !id.startsWith('team:')).map((id) => {
                const a = agents.find((x) => x.id === id);
                const r = form.roles?.[id] ?? { role: '', instructions: '' };
                const put = (patch: Partial<typeof r>) => set({ roles: { ...form.roles, [id]: { ...r, ...patch } } });
                return (
                  <details key={id} open={!!(r.role || r.instructions)}>
                    <summary>
                      {a && <Avatar agent={a} />}<b>{id === form.main ? '★ ' : ''}{a?.name ?? id}</b>
                      <small>{r.role || a?.role || '역할 없음'}{r.instructions ? ' · 추가 지시 있음' : ''}</small>
                    </summary>
                    <label>팀 내 역할<input maxLength={200} value={r.role} placeholder={a?.role || '예: 백엔드 담당'} onChange={(e) => put({ role: e.target.value })} /></label>
                    <label>추가 지시<textarea rows={3} maxLength={4000} value={r.instructions} placeholder="예: 테스트 코드는 쓰지 말고 결과만 보고해" onChange={(e) => put({ instructions: e.target.value })} /></label>
                  </details>
                );
              })}
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
