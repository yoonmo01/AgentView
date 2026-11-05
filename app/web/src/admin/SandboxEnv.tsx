import { useEffect, useState } from 'react';
import { api, type AgentDef } from '../api.ts';
import { DEFAULT_IMAGE } from './newAgent.ts';

type Kind = 'pip' | 'npm' | 'apt';
type Env = { base: string; tag: string | null; status: 'none' | 'building' | 'ready' | 'failed'; log: string };
const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'pip', label: 'Python 패키지 (pip)', hint: '예: pandas matplotlib requests==2.32.3' },
  { kind: 'npm', label: 'Node 패키지 (npm, 전역 설치)', hint: '예: typescript @types/node' },
  { kind: 'apt', label: '시스템 패키지 (apt)', hint: '예: ffmpeg' },
];
export const parsePackages = (text: string) => [...new Set(text.split(/[\s,]+/).filter(Boolean))];

/**
 * The agent's sandbox: what the base image has, extra packages to bake in, and how building that image went.
 * `texts` holds the package fields as typed; they become lists on save.
 */
export function SandboxEnv({ form, texts, onTexts, onSandbox, saved }: {
  form: AgentDef; texts: Record<Kind, string>; onTexts: (t: Record<Kind, string>) => void;
  onSandbox: (s: AgentDef['sandbox']) => void; /** id of the saved agent, to show its build; undefined while new */ saved?: string;
}) {
  const [env, setEnv] = useState<Env | null>(null);
  useEffect(() => {
    if (!saved) return setEnv(null);
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => api<Env>(`/agents/${saved}/env`).then((e) => {
      if (stop) return;
      setEnv(e);
      if (e.status === 'building') timer = setTimeout(poll, 2000);
    }).catch(() => {});
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [saved, form.sandbox.packages, form.sandbox.image]);
  return (
    <fieldset className="sandbox-env">
      <legend>샌드박스 환경</legend>
      <p className="muted small">
        {form.sandbox.image === DEFAULT_IMAGE ? '기본 포함: Python 3.12, Node.js, npm, git' : `기본 이미지: ${form.sandbox.image}`}
        {' · '}아래 패키지는 이 위에 한 번 설치해 이미지로 만들어 둬요. 설치할 때만 인터넷을 쓰고, 다 되면 다음 작업부터 그 환경으로 바뀌어요.
      </p>
      {KINDS.map(({ kind, label, hint }) => (
        <label key={kind}>+ {label}
          <input value={texts[kind]} placeholder={hint} onChange={(e) => onTexts({ ...texts, [kind]: e.target.value })} />
        </label>
      ))}
      <label>기본 이미지
        <input value={form.sandbox.image} onChange={(e) => onSandbox({ ...form.sandbox, image: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={form.sandbox.network} onChange={(e) => onSandbox({ ...form.sandbox, network: e.target.checked })} />
        작업 중 인터넷 허용 (에이전트가 직접 설치한 패키지는 컨테이너를 다시 만들면 사라져요. 계속 쓸 건 위에 적으세요)
      </label>
      {env && env.status !== 'none' && (
        <div className={`env-status ${env.status}`} role="status">
          {env.status === 'building' ? '환경 준비 중… 패키지를 설치하고 있어요.' : env.status === 'ready' ? '환경 준비됨: 다음 작업부터 이 패키지를 쓸 수 있어요.' : '환경을 만들지 못했어요. 패키지 이름을 확인하세요. 그동안은 기본 환경으로 동작해요.'}
          {env.log && <details open={env.status === 'failed'}><summary>설치 기록</summary><pre>{env.log.slice(-4000)}</pre></details>}
        </div>
      )}
    </fieldset>
  );
}
