import { useEffect, useRef, useState } from 'react';

/** These come first, in this order; every other family follows alphabetically under its own heading. */
const FIRST = ['GPT', 'Claude', 'Gemini'];
const NAMES: Record<string, string> = { gpt: 'GPT', o1: 'GPT', o3: 'GPT', o4: 'GPT', claude: 'Claude', gemini: 'Gemini', gemma: 'Gemma', deepseek: 'DeepSeek', glm: 'GLM', qwen: 'Qwen', llama: 'Llama', mistral: 'Mistral', grok: 'Grok' };

/** Family heading for a gateway model id, from its first word ("google/gemma-4-31B-it" → Gemma). */
export function groupOf(m: string): string {
  const word = (m.split('/').pop() ?? m).split(/[-_.\s]/)[0].toLowerCase();
  const base = word.replace(/\d+$/, '') || word; // qwen3 → qwen
  return NAMES[word] ?? NAMES[base] ?? base.charAt(0).toUpperCase() + base.slice(1);
}
const rank = (g: string) => (FIRST.includes(g) ? FIRST.indexOf(g) : FIRST.length);
export const compareGroups = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);

/** Version numbers in an id, ignoring sizes like 31B and dates like 20251001. */
const version = (m: string) => (m.replace(/\d+[bB]|\d{8}/g, '').match(/\d+/g) ?? []).map(Number);
/** Newest first inside a family: higher version numbers win, then the name decides. */
export function compareModels(a: string, b: string): number {
  const va = version(a), vb = version(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] ?? -1) !== (vb[i] ?? -1)) return (vb[i] ?? -1) - (va[i] ?? -1);
  return a.localeCompare(b);
}

/**
 * Model picker for one message: a button that opens a searchable list grouped by provider, above the composer.
 * `value` '' means the agent's default model.
 */
export function ModelPicker({ value, models, defaultModel, compact, down, onChange }: {
  value: string; models: string[]; defaultModel: string; compact?: boolean; /** open the list below the button (in forms) */ down?: boolean; onChange: (m: string) => void;
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
  const groups = [...new Set(shown.map(groupOf))].sort(compareGroups);
  const label = value || (compact ? defaultModel || '기본 모델' : `기본 모델 (${defaultModel || '연결 기본값'})`);

  return (
    <div className={down ? "model-picker down" : "model-picker"} ref={box} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="model-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox" title={down ? "이 에이전트의 기본 모델" : "이 메시지에 쓸 모델"}>
        <span>{label}</span><span aria-hidden className="caret-down" />
      </button>
      {open && (
        <div className="model-pop" role="listbox" aria-label="모델">
          <input autoFocus placeholder="모델 검색" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const first = groups[0] && shown.filter((m) => groupOf(m) === groups[0]).sort(compareModels)[0]; if (first) pick(first); } }} />
          <div className="model-list">
            {!q && (
              <button type="button" role="option" aria-selected={!value} onClick={() => pick('')}>
                기본 모델 <small>{defaultModel}</small>
              </button>
            )}
            {groups.map((g) => (
              <div key={g}>
                <div className="model-group">{g}</div>
                {shown.filter((m) => groupOf(m) === g).sort(compareModels).map((m) => (
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
