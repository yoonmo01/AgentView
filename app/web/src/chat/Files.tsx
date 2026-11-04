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
  if (!files) return <p className="muted">불러오는 중…</p>;
  if (!files.length) return <p className="muted">작업 폴더가 비어 있어요.</p>;
  return (
    <div className="files-view">
      <ul className="files">
        {files.map((f) => <li key={f}><button aria-pressed={open?.path === f} onClick={() => show(f)}>{f}</button></li>)}
      </ul>
      {open ? <pre aria-label={open.path}>{open.text}</pre> : <p className="muted">파일을 누르면 내용이 보여요.</p>}
    </div>
  );
}
