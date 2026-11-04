import { useEffect, useState } from 'react';
import { api } from '../api.ts';

/** The agent's workspace (/work in its sandbox): file list and a text preview. */
export function Files({ agentId, refresh }: { agentId: string; refresh: unknown }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null);
  useEffect(() => {
    setOpen(null);
    api<string[]>(`/agents/${agentId}/files`).then(setFiles).catch(() => setFiles([]));
  }, [agentId, refresh]);
  const show = (p: string) =>
    fetch(`/api/agents/${agentId}/files/${p.split('/').map(encodeURIComponent).join('/')}`)
      .then((r) => r.text()).then((text) => setOpen({ path: p, text }));
  // the empty states fill the panel too, so the composer stays at the bottom
  if (!files) return <div className="files-view empty"><p className="empty-note">불러오는 중…</p></div>;
  if (!files.length) return <div className="files-view empty"><p className="empty-note">작업 폴더가 비어 있어요. 에이전트가 파일을 만들면 여기에 보여요.</p></div>;
  return (
    <div className="files-view">
      <ul className="files">
        {files.map((f) => <li key={f}><button aria-pressed={open?.path === f} onClick={() => show(f)}>{f}</button></li>)}
      </ul>
      {open ? <pre aria-label={open.path}>{open.text}</pre> : <p className="muted">파일을 누르면 내용이 보여요.</p>}
    </div>
  );
}
