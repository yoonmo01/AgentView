import { useEffect, useState } from 'react';
import { api, type AgentDef } from '../api.ts';
import { DEFAULT_IMAGE } from './newAgent.ts';
import { EMPTY, PackagePicker } from './PackagePicker.tsx';

type Env = { base: string; tag: string | null; status: 'none' | 'building' | 'ready' | 'failed'; log: string };

/** The agent's sandbox: what the base image has, extra packages to bake in, and how building that image went. */
export function SandboxEnv({ form, onSandbox, saved, rev }: {
  form: AgentDef; onSandbox: (s: AgentDef['sandbox']) => void; /** id of the saved agent, to show its build; undefined while new */ saved?: string;
  /** bumped on every save: the build starts then, so its status is read again */ rev: number;
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
  }, [saved, rev]);
  return (
    <fieldset className="sandbox-env">
      <legend>샌드박스 환경</legend>
      <p className="muted small">
        {form.sandbox.image === DEFAULT_IMAGE ? '기본 포함: Python 3.12, Node.js, npm, git · 한국 시간(KST)' : `기본 이미지: ${form.sandbox.image}`}
        {' · '}고른 패키지는 이 위에 한 번 설치해 이미지로 만들어 둬요. 설치할 때만 인터넷을 쓰고, 저장 후 준비되면 다음 작업부터 그 환경으로 바뀌어요.
      </p>
      <PackagePicker value={form.sandbox.packages ?? EMPTY} onChange={(packages) => onSandbox({ ...form.sandbox, packages })} />
      <label>기본 이미지
        <input value={form.sandbox.image} onChange={(e) => onSandbox({ ...form.sandbox, image: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={form.sandbox.network} onChange={(e) => onSandbox({ ...form.sandbox, network: e.target.checked })} />
        작업 중 인터넷 허용 <small className="muted">(위 패키지 설치는 꺼져 있어도 돼요)</small>
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
