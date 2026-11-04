import { useEffect, useRef, useState } from 'react';

const GROUPS: [string, RegExp][] = [
  ['Claude', /^claude/], ['GPT', /^(gpt|o\d)/], ['Gemini · Gemma', /gemini|gemma/], ['DeepSeek', /^deepseek/], ['GLM', /^glm/],
];
/** Provider heading for a gateway model id; anything unknown goes under "기타". */
export const groupOf = (m: string) => GROUPS.find(([, re]) => re.test(m.toLowerCase()))?.[0] ?? '기타';

/**
 * Model picker for one message: a button that opens a searchable list grouped by provider, above the composer.
 * `value` '' means the agent's default model.
 */
export function ModelPicker({ value, models, defaultModel, compact, onChange }: {
  value: string; models: string[]; defaultModel: string; compact?: boolean; onChange: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const pick = (m: string) => { onChange(m); setOpen(false); setQ(''); };
  const shown = models.filter((m) => m !== defaultModel && m.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = [...new Set(shown.map(groupOf))];
  const label = value || (compact ? defaultModel || '기본 모델' : `기본 모델 (${defaultModel || '연결 기본값'})`);

  return (
    <div className="model-picker" ref={box} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="model-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox" title="이 메시지에 쓸 모델">
        <span>{label}</span><span aria-hidden className="caret-down" />
      </button>
      {open && (
        <div className="model-pop" role="listbox" aria-label="모델">
          <input autoFocus placeholder="모델 검색" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) pick(shown[0]); } }} />
          <div className="model-list">
            {!q && (
              <button type="button" role="option" aria-selected={!value} onClick={() => pick('')}>
                기본 모델 <small>{defaultModel}</small>
              </button>
            )}
            {groups.map((g) => (
              <div key={g}>
                <div className="model-group">{g}</div>
                {shown.filter((m) => groupOf(m) === g).map((m) => (
                  <button key={m} type="button" role="option" aria-selected={value === m} onClick={() => pick(m)}>{m}</button>
                ))}
              </div>
            ))}
            {!shown.length && q && <p className="muted small">"{q}"에 맞는 모델이 없어요.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
