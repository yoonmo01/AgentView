import { useEffect, useState, type FormEvent } from 'react';
import { api, type PluginState } from '../api.ts';
import { ask } from '../shell/ask.ts';

/**
 * Plugins: add a marketplace (a GitHub repo with .claude-plugin/marketplace.json, the Claude Code format), then
 * install its plugins. A plugin's skills go to the skills tab, its MCP servers to the tools tab, its agents
 * become templates in the agent form. Hooks are listed but never run.
 */
export function Plugins({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<PluginState>({ marketplaces: [], installed: [] });
  const [repo, setRepo] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // what is being added or installed
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const reload = () => api<PluginState>('/plugins').then(setState).catch((e: Error) => setMsg({ text: e.message, error: true }));
  useEffect(() => { void reload(); }, []);
  const run = async <T,>(what: string, fn: () => Promise<T>, done: string | ((r: T) => string)) => {
    setBusy(what); setMsg(null);
    try { const r = await fn(); setMsg({ text: typeof done === 'string' ? done : done(r) }); await reload(); onChanged?.(); } catch (e) { setMsg({ text: (e as Error).message, error: true }); } finally { setBusy(null); }
  };

  const addMarket = (e: FormEvent) => {
    e.preventDefault();
    void run('market', async () => {
      const r = await api<{ kind: 'marketplace' | 'plugin'; installed?: { name: string; skills: string[] } }>('/plugins/add', { method: 'POST', body: { repo: repo.trim() } });
      setRepo('');
      return r;
    }, (r) => r.kind === 'plugin'
      ? `플러그인 하나짜리 저장소라 바로 설치했어요: ${r.installed!.name} (스킬 ${r.installed!.skills.length}개)`
      : '마켓플레이스를 추가했어요. 아래에서 플러그인을 골라 설치하세요.');
  };
  const installed = new Map(state.installed.map((p) => [p.name, p]));
  const catalog = state.marketplaces.flatMap((m) => m.plugins.map((p) => ({ ...p, marketplace: m.name })))
    .filter((p) => !query.trim() || `${p.name} ${p.description}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="plugins-page">
      {msg && <p className={msg.error ? 'error' : 'ok'} role="status">{msg.text}</p>}

      <section className="tool-card">
        <h2>마켓플레이스 · 플러그인 추가</h2>
        <p className="muted small">GitHub 주소를 넣으면 알아서 구분해요. 플러그인 목록(marketplace.json)이 있으면 마켓플레이스로 추가하고, 플러그인 하나(plugin.json이나 skills/)만 있으면 바로 설치해요. 예: obra/superpowers, anthropics/claude-plugins-official</p>
        <form className="inline-add" onSubmit={addMarket}>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo 또는 https://github.com/owner/repo" aria-label="마켓플레이스 또는 플러그인 GitHub 주소" />
          <button type="submit" disabled={!repo.trim() || !!busy}>{busy === 'market' ? '읽는 중…' : '추가'}</button>
        </form>
        <ul>
          {state.marketplaces.map((m) => (
            <li key={m.name}>
              <div><b>{m.name.startsWith('github:') ? m.plugins[0]?.name : m.name}</b> <code>{m.repo}@{m.ref}</code><small>{m.name.startsWith('github:') ? '플러그인 저장소 (직접 설치)' : `플러그인 ${m.plugins.length}개`}</small></div>
              {!m.name.startsWith('github:') && <button type="button" disabled={!!busy} onClick={() => void run(`r-${m.name}`, () => api(`/plugins/marketplaces/${encodeURIComponent(m.name)}/refresh`, { method: 'POST' }), '목록을 새로 읽었어요.')}>새로 읽기</button>}
              <button type="button" className="danger" disabled={!!busy} onClick={async () => { if (await ask(`${m.name} 마켓플레이스를 목록에서 뺄까요? 설치한 플러그인은 그대로예요.`, '빼기')) void run('rm', () => api(`/plugins/marketplaces/${encodeURIComponent(m.name)}`, { method: 'DELETE' }), '뺐어요.'); }}>빼기</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="tool-card">
        <h2>설치한 플러그인</h2>
        {!state.installed.length && <p className="muted small">아직 없어요.</p>}
        <ul>
          {state.installed.map((p) => (
            <li key={p.name} className="plugin-row">
              <div>
                <b>{p.name}</b> {p.version && <code>v{p.version}</code>}<small>{p.description}</small>
                <span className="plugin-parts">
                  <span>스킬 {p.skills.length}</span>
                  <span>외부 도구 {p.mcp.length}</span>
                  <span>에이전트 템플릿 {p.agents.length}</span>
                  {p.commands > 0 && <span className="off" title="채팅 명령은 아직 지원하지 않아요">명령 {p.commands} · 나중에</span>}
                  {p.hooks > 0 && <span className="off" title="훅은 이 컴퓨터에서 코드를 실행해서 실행하지 않아요">훅 {p.hooks} · 실행 안 함</span>}
                </span>
                {p.notes.map((n) => <small key={n} className="warn">{n}</small>)}
              </div>
              <button type="button" className="danger" disabled={!!busy} onClick={async () => { if (await ask(`${p.name} 플러그인을 지울까요? 이 플러그인의 스킬과 외부 도구도 함께 지워져요.`)) void run('un', () => api(`/plugins/${encodeURIComponent(p.name)}`, { method: 'DELETE' }), '지웠어요.'); }}>제거</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="tool-card">
        <h2>설치할 수 있는 플러그인</h2>
        {state.marketplaces.length > 0 && <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름이나 설명으로 찾기" />}
        {!state.marketplaces.length && <p className="muted small">마켓플레이스를 먼저 추가하세요.</p>}
        <ul>
          {catalog.slice(0, 200).map((p) => (
            <li key={`${p.marketplace}/${p.name}`}>
              <div><b>{p.name}</b> {p.version && <code>v{p.version}</code>}<small>{p.description}</small></div>
              <button type="button" className={installed.has(p.name) ? undefined : 'primary'} disabled={!!busy}
                onClick={() => void run(p.name, () => api('/plugins/install', { method: 'POST', body: { marketplace: p.marketplace, plugin: p.name } }), `${p.name} 플러그인을 설치했어요.`)}>
                {busy === p.name ? '설치 중…' : installed.has(p.name) ? '다시 설치' : '설치'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
