import { useEffect, useState } from 'react';
import { api, type AgentDef, type ToolInfo } from '../api.ts';
import { Avatar } from '../shell/ui.tsx';
import { Mcp } from './Mcp.tsx';
import { TOOL_HELP, TOOL_KO } from './toolNames.ts';

/**
 * Every tool an agent can be given: the built-in ones (with who uses each) and external ones from MCP servers.
 * Agents get tools in their own settings; this page shows what exists and adds MCP servers.
 */
export function Tools({ onChanged }: { onChanged?: () => void }) {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  useEffect(() => {
    api<ToolInfo[]>('/tools').then(setTools).catch(() => {});
    api<AgentDef[]>('/agents').then(setAgents).catch(() => {});
  }, []);
  return (
    <div className="tools-page">
      <section className="tool-list">
        <h2>기본 도구</h2>
        <p className="muted small">AgentView에 들어 있는 도구예요. 에이전트 설정에서 에이전트마다 켜고 꺼요.</p>
        <ul>
          {tools.filter((t) => !t.server).map((t) => {
            const users = agents.filter((a) => a.tools.includes(t.name));
            return (
              <li key={t.name}>
                <div><b>{TOOL_KO[t.name] ?? t.name}</b> <code>{t.name}</code><small>{TOOL_HELP[t.name] ?? t.description}</small></div>
                <span className="users" title={users.map((a) => a.name).join(', ') || '쓰는 에이전트 없음'}>
                  {users.length ? users.map((a) => <Avatar key={a.id} agent={a} />) : <small className="muted">없음</small>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <h2 className="tools-sub">외부 도구 (MCP)</h2>
      <Mcp onChanged={onChanged} />
    </div>
  );
}
