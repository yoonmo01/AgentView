import { listFiles, readFile, workspaceDir, writeFile, type ExecResult } from './sandbox.ts';
import type { Agent, ToolDef } from './store.ts';

export type ExecFn = (agent: Agent, command: string, timeoutSec: number, signal: AbortSignal) => Promise<ExecResult>;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const str = (description: string) => ({ type: 'string', description });

const DEFS: ToolDef[] = [
  { type: 'function', function: { name: 'sandbox_list_files', description: 'List files in your workspace (/work), one path per line.', parameters: obj({ dir: str('Folder inside /work. Default ".".') }) } },
  { type: 'function', function: { name: 'sandbox_read_file', description: 'Read a UTF-8 text file from your workspace.', parameters: obj({ path: str('Path inside /work.') }, ['path']) } },
  { type: 'function', function: { name: 'sandbox_write_file', description: 'Create or overwrite a text file in your workspace.', parameters: obj({ path: str('Path inside /work.'), content: str('Full file content.') }, ['path', 'content']) } },
  { type: 'function', function: { name: 'sandbox_run', description: 'Run a shell command in your sandbox (working directory /work). Returns exit code, stdout and stderr.', parameters: obj({ command: str('Shell command.'), timeoutSec: { type: 'integer', minimum: 1, maximum: 600, description: 'Default 60.' } }, ['command']) } },
];

export const toolDefs = (agent: Agent): ToolDef[] => DEFS.filter((d) => agent.tools.includes(d.function.name));

const MAX_OUT = 4_000; // tool output goes back into the model context, so keep it short
const clip = (s: string) => (s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n...(${s.length - MAX_OUT} more characters cut)` : s);

/** One tool call. Failures come back as "ERROR: ..." text so the model can react; cancellation propagates. */
export async function runTool(agent: Agent, name: string, rawArgs: string, signal: AbortSignal, env: { dataDir: string; exec: ExecFn }): Promise<string> {
  try {
    if (!agent.tools.includes(name)) throw new Error(`tool not allowed for this agent: ${name}`);
    const args = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
    const root = workspaceDir(env.dataDir, agent.id);
    switch (name) {
      case 'sandbox_list_files':
        return clip((await listFiles(root, String(args.dir ?? '.'))).join('\n') || '(no files)');
      case 'sandbox_read_file':
        return clip(await readFile(root, String(args.path ?? '')));
      case 'sandbox_write_file':
        await writeFile(root, String(args.path ?? ''), args.content);
        return `wrote ${String(args.path)}`;
      case 'sandbox_run': {
        if (typeof args.command !== 'string') throw new Error('command must be a string');
        const timeoutSec = Math.min(Math.max(Number(args.timeoutSec ?? 60) || 60, 1), 600);
        const r = await env.exec(agent, args.command, timeoutSec, signal);
        return clip(`exit code: ${r.exitCode}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (e) {
    if (signal.aborted) throw e;
    return `ERROR: ${(e as Error).message}`;
  }
}
