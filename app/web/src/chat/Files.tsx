import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { CodeView } from './CodeView.tsx';

type Dir = { dirs: Map<string, Dir>; files: string[] };
const newDir = (): Dir => ({ dirs: new Map(), files: [] });

/** Sorted paths ("src/a.py") into folders; folders come before files at each level. */
function tree(paths: string[]): Dir {
  const root = newDir();
  for (const p of paths) {
    let d = root;
    for (const part of p.split('/').slice(0, -1)) d = d.dirs.get(part) ?? d.dirs.set(part, newDir()).get(part)!;
    d.files.push(p);
  }
  return root;
}

function Folder({ dir, open, onOpen }: { dir: Dir; open?: string; onOpen: (path: string) => void }) {
  return (
    <ul className="files">
      {[...dir.dirs].map(([name, sub]) => (
        <li key={name}><details open><summary>{name}</summary><Folder dir={sub} open={open} onOpen={onOpen} /></details></li>
      ))}
      {dir.files.map((f) => (
        <li key={f}><button aria-pressed={open === f} onClick={() => onOpen(f)} title={f}>{f.split('/').at(-1)}</button></li>
      ))}
    </ul>
  );
}

/** A work folder (an agent's /work or a team's shared folder, by `base` = /agents/<id> or /teams/<id>): a folder tree, a text preview, and downloads. */
export function Files({ base, team, refresh }: { base: string; team?: boolean; refresh: unknown }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null);
  useEffect(() => {
    setOpen(null);
    setError(null);
    api<string[]>(`${base}/files`).then(setFiles).catch((e: Error) => { setFiles([]); setError(e.message); });
  }, [base, refresh]);
  const url = (p: string) => `/api${base}/files/${p.split('/').map(encodeURIComponent).join('/')}`;
  const show = (p: string) => fetch(url(p)).then((r) => r.text()).then((text) => setOpen({ path: p, text }));
  // the empty states fill the panel too, so the composer stays at the bottom
  if (!files) return <div className="files-view empty"><p className="empty-note">작업 폴더를 여는 중…</p></div>;
  if (error) return <div className="files-view empty"><p className="empty-note">작업 폴더를 열 수 없어요. Docker가 켜져 있는지 확인하세요. <small>{error}</small></p></div>;
  if (!files.length) return <div className="files-view empty"><p className="empty-note">{team ? '팀 공유 폴더가 비어 있어요. 팀원이 파일을 만들면 여기에 보여요.' : '작업 폴더가 비어 있어요. 에이전트가 파일을 만들면 여기에 보여요.'}</p></div>;
  return (
    <div className="files-view">
      <div className="files-side">
        <a className="button" href={`/api${base}/zip`} download>폴더 전체 다운로드 (.zip)</a>
        <Folder dir={tree(files)} open={open?.path} onOpen={show} />
      </div>
      {open ? (
        <div className="files-open">
          {open.text.includes('\u0000')
            ? <p className="muted">미리 볼 수 없는 파일이에요. <a href={`${url(open.path)}?download=true`} download>다운로드</a>해서 여세요.</p>
            : <CodeView key={open.path} path={open.path} text={open.text} download={`${url(open.path)}?download=true`} />}
        </div>
      ) : <p className="muted">파일을 누르면 내용이 보여요.</p>}
    </div>
  );
}
