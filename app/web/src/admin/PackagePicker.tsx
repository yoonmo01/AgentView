import { useState } from 'react';
import type { AgentDef } from '../api.ts';

type Kind = 'pip' | 'npm' | 'apt';
export type Packages = NonNullable<AgentDef['sandbox']['packages']>;
type Pkg = { name: string; kind: Kind; note?: string };
const pip = (name: string, note?: string): Pkg => ({ name, kind: 'pip', note });
const npm = (name: string, note?: string): Pkg => ({ name, kind: 'npm', note });
const apt = (name: string, note?: string): Pkg => ({ name, kind: 'apt', note });

/** Packages agents commonly need, grouped; each knows its installer. Anything else goes in by hand. */
export const GROUPS: { title: string; items: Pkg[] }[] = [
  { title: '데이터 분석', items: [pip('pandas'), pip('numpy'), pip('matplotlib'), pip('seaborn'), pip('scikit-learn'), pip('openpyxl', '엑셀')] },
  { title: '웹·크롤링', items: [pip('requests'), pip('beautifulsoup4'), pip('lxml')] },
  { title: '문서·PDF', items: [pip('python-docx', '워드'), pip('python-pptx', '파워포인트'), pip('pypdf'), pip('pdfplumber', 'PDF 표 읽기'), pip('reportlab', 'PDF 만들기')] },
  { title: '이미지·영상', items: [pip('pillow'), apt('ffmpeg')] },
  { title: '한글', items: [apt('fonts-nanum', '차트 한글 깨짐 방지')] },
  { title: '코드 품질·테스트', items: [pip('pytest'), pip('ruff'), npm('typescript'), npm('tsx', 'TypeScript 바로 실행')] },
  { title: '기본 유틸', items: [apt('jq', 'JSON 다루기'), apt('zip'), apt('unzip')] },
];
/** One tick for a usual combination. */
export const SETS: { title: string; items: string[] }[] = [
  { title: '데이터 분석 세트', items: ['pandas', 'numpy', 'matplotlib', 'seaborn', 'openpyxl', 'fonts-nanum'] },
  { title: '웹 크롤링 세트', items: ['requests', 'beautifulsoup4', 'lxml'] },
  { title: '문서 만들기 세트', items: ['python-docx', 'python-pptx', 'reportlab', 'pypdf'] },
];
const ALL = GROUPS.flatMap((g) => g.items);
/** Same rules as the server (sandbox.ts PKG): names, an optional version, nothing a shell would read. */
const VALID: Record<Kind, RegExp> = {
  pip: /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?([=<>!~]=?[A-Za-z0-9.*+-]+)?$/,
  npm: /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9.^~*+-]+)?$/,
  apt: /^[a-z0-9][a-z0-9+.-]*(=[A-Za-z0-9.:~+-]+)?$/,
};
export const EMPTY: Packages = { pip: [], npm: [], apt: [] };

const has = (p: Packages, x: Pkg) => p[x.kind].includes(x.name);
const toggle = (p: Packages, xs: Pkg[], on: boolean): Packages => {
  const next = { pip: [...p.pip], npm: [...p.npm], apt: [...p.apt] };
  for (const x of xs) next[x.kind] = on ? [...new Set([...next[x.kind], x.name])] : next[x.kind].filter((n) => n !== x.name);
  return next;
};

/** A drop-down of checkboxes for the sandbox's extra packages, with sets, search and a field for anything not listed. */
export function PackagePicker({ value, onChange }: { value: Packages; onChange: (p: Packages) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState<{ name: string; kind: Kind }>({ name: '', kind: 'pip' });
  const picked = (['pip', 'npm', 'apt'] as Kind[]).flatMap((kind) => value[kind].map((name) => ({ name, kind })));
  const match = (x: Pkg) => !q.trim() || `${x.name} ${x.note ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());
  const customOk = VALID[custom.kind].test(custom.name.trim());
  const addCustom = () => { if (customOk) { onChange(toggle(value, [{ name: custom.name.trim(), kind: custom.kind }], true)); setCustom({ ...custom, name: '' }); } };

  return (
    <div className="pkg-picker">
      <button type="button" className="pkg-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={picked.length ? "label on" : "label"}>{picked.length ? `추가 패키지 ${picked.length}개 선택됨` : '추가 패키지 고르기'}</span>
        <span className="caret" aria-hidden>▾</span>
      </button>
      {picked.length > 0 && (
        <div className="pkg-chips">
          {picked.map((x) => (
            <span key={`${x.kind}:${x.name}`} className="pkg-chip" title={x.kind}>
              {x.name}<small>{x.kind}</small>
              <button type="button" aria-label={`${x.name} 빼기`} onClick={() => onChange(toggle(value, [x], false))}>✕</button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="pkg-panel">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="패키지 찾기" aria-label="패키지 찾기" />
          {!q.trim() && (
            <div className="pkg-group">
              <b>세트</b>
              {SETS.map((s) => {
                const items = ALL.filter((x) => s.items.includes(x.name));
                return (
                  <label key={s.title} className="check" title={s.items.join(', ')}>
                    <input type="checkbox" checked={items.every((x) => has(value, x))} onChange={(e) => onChange(toggle(value, items, e.target.checked))} />
                    {s.title} <small>{s.items.length}개</small>
                  </label>
                );
              })}
            </div>
          )}
          {GROUPS.map((g) => {
            const items = g.items.filter(match);
            if (!items.length) return null;
            return (
              <div key={g.title} className="pkg-group">
                <b>{g.title}</b>
                {items.map((x) => (
                  <label key={x.name} className="check">
                    <input type="checkbox" checked={has(value, x)} onChange={(e) => onChange(toggle(value, [x], e.target.checked))} />
                    {x.name} {x.note && <small>{x.note}</small>}
                  </label>
                ))}
              </div>
            );
          })}
          <div className="pkg-custom">
            <b>목록에 없는 패키지</b>
            <div>
              <select value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value as Kind })} aria-label="설치 방식">
                <option value="pip">pip</option><option value="npm">npm</option><option value="apt">apt</option>
              </select>
              <input value={custom.name} placeholder="예: requests==2.32.3" aria-label="패키지 이름"
                onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
              <button type="button" disabled={!customOk} onClick={addCustom}>추가</button>
            </div>
            {custom.name.trim() && !customOk && <small className="field-error">패키지 이름 형식이 아니에요 (이름, 필요하면 ==버전)</small>}
          </div>
        </div>
      )}
    </div>
  );
}
