import { useEffect, useRef } from 'react';

/** What is wrong with an id (lowercase letters, digits and -, starting with a letter or digit), or null. */
export function idProblem(v: string, max: number): string | null {
  if (!v) return null;
  if (/[^a-z0-9-]/.test(v)) return '영문 소문자, 숫자, -만 쓸 수 있어요';
  if (v.startsWith('-')) return '-로 시작할 수 없어요';
  if (v.length > max) return `${max}자까지 쓸 수 있어요`;
  return null;
}

/**
 * An id input that lowercases as you type and says right away what is wrong; the form will not submit while it is wrong.
 */
export function IdField({ label, value, onChange, max = 41, required, disabled, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; max?: number; required?: boolean; disabled?: boolean; placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const problem = idProblem(value, max);
  useEffect(() => { ref.current?.setCustomValidity(problem ?? ''); }, [problem]);
  return (
    <label>{label}
      <input ref={ref} value={value} required={required} disabled={disabled} placeholder={placeholder} aria-invalid={!!problem}
        onChange={(e) => onChange(e.target.value.toLowerCase())} />
      {problem && <small className="field-error" role="alert">{problem}</small>}
    </label>
  );
}
