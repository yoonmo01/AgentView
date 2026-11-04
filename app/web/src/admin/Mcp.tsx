import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';

type McpServer = {
  name: string;
  config: { url?: string; command?: string; args?: string[]; env?: Record<string, string>; network?: boolean };
  status: 'connecting' | 'connected' | 'failed' | 'auth';
  error?: string;
  tools: { name: string; description: string }[];
};
const STATUS: Record<McpServer['status'], string> = { connecting: '연결 중', connected: '연결됨', failed: '실패', auth: '인증 필요' };
type Mode = 'url' | 'command' | 'json';
const EXAMPLE = '{\n  "mcpServers": {\n    "everything": { "command": "mcp-server-everything", "args": ["stdio"] }\n  }\n}';

export function Mcp({ onChanged }: { onChanged?: () => void } = {}) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<Mode>('command');
  const [f, setF] = useState({ name: '', url: '', command: '', args: '', env: '', network: false, json: EXAMPLE });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const fail = (e: unknown) => setMsg({ text: (e as Error).message, error: true });
  const reload = () => api<McpServer[]>('/mcp').then(setServers);
  useEffect(() => { reload().catch(fail); }, []);
  const current = servers.find((s) => s.name === picked);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
      const body = mode === 'json' ? JSON.parse(f.json)
        : mode === 'url' ? { name: f.name, url: f.url }
        : { name: f.name, command: f.command, args: lines(f.args), network: f.network,
            env: Object.fromEntries(lines(f.env).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) };
      const added = await api<McpServer[]>('/mcp', { method: 'POST', body });
      await reload();
      onChanged?.();
      setAdding(false);
      setPicked(added[0]?.name ?? null);
      const bad = added.filter((s) => s.status !== 'connected');
      setMsg(bad.length ? { text: `추가했지만 연결하지 못했어요: ${bad.map((s) => `${s.name} (${s.error ?? STATUS[s.status]})`).join(', ')}`, error: true }
        : { text: `추가하고 연결했어요. 도구 ${added.reduce((n, s) => n + s.tools.length, 0)}개` });
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  async function act(kind: 'reconnect' | 'delete') {
    if (!current) return;
    if (kind === 'delete' && !confirm(`${current.name} 서버를 지울까요? 이 서버 도구를 쓰는 에이전트는 다음 호출에서 오류를 받아요.`)) return;
    setBusy(true);
    try {
      await api(kind === 'delete' ? `/mcp/${current.name}` : `/mcp/${current.name}/reconnect`, { method: kind === 'delete' ? 'DELETE' : 'POST' });
      if (kind === 'delete') setPicked(null);
      await reload();
      onChanged?.();
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  return (
    <div className="admin">
      <aside>
        <h2>MCP 서버</h2>
        <ul className="list">
          {servers.map((s) => (
            <li key={s.name}>
              <button aria-pressed={picked === s.name && !adding} onClick={() => { setPicked(s.name); setAdding(false); setMsg(null); }}>
                <span className={`dot st-${s.status}`} /> {s.name} <small>{STATUS[s.status]} · 도구 {s.tools.length}개</small>
              </button>
            </li>
          ))}
        </ul>
        <button className="primary" onClick={() => { setAdding(true); setMsg(null); }}>+ 서버 추가</button>
        <small>추가하면 바로 연결돼요. 서버를 재시작할 필요가 없어요. 에이전트가 쓰려면 에이전트 탭에서 도구를 허용하세요.</small>
      </aside>

      <section>
        {msg && <p className={msg.error ? 'error' : 'ok'} role="status">{msg.text}</p>}
        {adding ? (
          <form onSubmit={add} className="form">
            <h2>MCP 서버 추가</h2>
            <div role="radiogroup" className="row">
              {(['command', 'url', 'json'] as Mode[]).map((m) => (
                <label key={m} className="check">
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                  {m === 'command' ? '명령 (stdio, 샌드박스 컨테이너에서 실행)' : m === 'url' ? 'URL (Streamable HTTP)' : 'JSON 붙여넣기 (mcpServers)'}
                </label>
              ))}
            </div>
            {mode !== 'json' && (
              <label>이름 (영문 소문자·숫자·-)
                <input required pattern="[a-z0-9][a-z0-9\-]{0,30}" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </label>
            )}
            {mode === 'url' && <label>URL<input required type="url" placeholder="https://example.com/mcp" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>}
            {mode === 'command' && (
              <>
                <label>명령<input required placeholder="mcp-server-everything" value={f.command} onChange={(e) => setF({ ...f, command: e.target.value })} /></label>
                <label>인자 (한 줄에 하나)<textarea rows={3} placeholder="stdio" value={f.args} onChange={(e) => setF({ ...f, args: e.target.value })} /></label>
                <label>환경 변수 (한 줄에 KEY=VALUE)<textarea rows={2} value={f.env} onChange={(e) => setF({ ...f, env: e.target.value })} /></label>
                <label className="check">
                  <input type="checkbox" checked={f.network} onChange={(e) => setF({ ...f, network: e.target.checked })} />
                  컨테이너 인터넷 허용 (npx로 패키지를 받는 서버라면 필요)
                </label>
              </>
            )}
            {mode === 'json' && (
              <label>Claude Desktop·Cursor와 같은 mcpServers 형식
                <textarea rows={10} className="mono" value={f.json} onChange={(e) => setF({ ...f, json: e.target.value })} />
              </label>
            )}
            <div className="actions"><button className="primary" type="submit" disabled={busy}>{busy ? '연결 중…' : '추가하고 연결'}</button></div>
          </form>
        ) : !current ? <p>왼쪽에서 서버를 고르거나 새로 추가하세요.</p> : (
          <div className="form">
            <h2>{current.name} <small>{STATUS[current.status]}</small></h2>
            {current.error && <p className="error">{current.error}</p>}
            <pre className="mono box">{JSON.stringify(current.config, null, 2)}</pre>
            <h3>도구 {current.tools.length}개</h3>
            <ul className="plain">{current.tools.map((t) => <li key={t.name}><code>{t.name}</code><br /><small>{t.description}</small></li>)}</ul>
            <div className="actions">
              <button type="button" onClick={() => act('reconnect')} disabled={busy}>다시 연결</button>
              <button type="button" className="danger" onClick={() => act('delete')} disabled={busy}>삭제</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
