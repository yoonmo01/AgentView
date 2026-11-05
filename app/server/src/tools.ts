import path from 'node:path';
import type { ExecResult, Files } from './sandbox.ts';
import type { Agent, ToolDef } from './store.ts';

export type ExecFn = (agent: Agent, command: string, timeoutSec: number, signal: AbortSignal) => Promise<ExecResult>;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const str = (description: string) => ({ type: 'string', description });
const WHERE = 'Path inside /work, or /team/<teamId>/... for a team shared folder.';

const DEFS: ToolDef[] = [
  { type: 'function', function: { name: 'sandbox_list_files', description: 'List files in your workspace (/work) or a team folder (/team/<teamId>), one path per line.', parameters: obj({ dir: str('Folder. Default "." (= /work).') }) } },
  { type: 'function', function: { name: 'sandbox_read_file', description: 'Read a UTF-8 text file from your workspace or a team folder.', parameters: obj({ path: str(WHERE) }, ['path']) } },
  { type: 'function', function: { name: 'sandbox_write_file', description: 'Create or overwrite a text file in your workspace or a team folder.', parameters: obj({ path: str(WHERE), content: str('Full file content.') }, ['path', 'content']) } },
  { type: 'function', function: { name: 'sandbox_edit_file', description: 'Change part of a text file: replace the exact text old_text with new_text. old_text must appear exactly once unless replace_all is true. Cheaper than rewriting the whole file.', parameters: obj({ path: str(WHERE), old_text: str('Exact text to find, with enough surrounding lines to be unique.'), new_text: str('Text to put in its place.'), replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' } }, ['path', 'old_text', 'new_text']) } },
  { type: 'function', function: { name: 'sandbox_search', description: 'Find lines matching a regular expression in files under a folder. Returns "path:line:text", at most 200 lines.', parameters: obj({ pattern: str('Regular expression (extended grep syntax).'), dir: str('Folder. Default "." (= /work).') }, ['pattern']) } },
  { type: 'function', function: { name: 'web_fetch', description: 'Read a web page (http or https) as plain text. Works only when this agent has internet access.', parameters: obj({ url: str('Full address, starting with http:// or https://.') }, ['url']) } },
  { type: 'function', function: { name: 'sandbox_run', description: 'Run a shell command in your sandbox (working directory /work). Returns exit code, stdout and stderr.', parameters: obj({ command: str('Shell command.'), timeoutSec: { type: 'integer', minimum: 1, maximum: 600, description: 'Default 60.' } }, ['command']) } },
];

export const toolDefs = (agent: Agent): ToolDef[] => DEFS.filter((d) => agent.tools.includes(d.function.name));
export const listTools = () => DEFS.map(({ function: f }) => ({ name: f.name, description: f.description }));

const MAX_OUT = 4_000; // tool output goes back into the model context, so keep it short
const clip = (s: string) => (s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n...(${s.length - MAX_OUT} more characters cut)` : s);

/**
 * The container path meant by a tool or the files screen: relative or /work/... is the agent's workspace,
 * /team/<id>/... a team folder (members only), /skills/... the skills (read-only, mounted so).
 * The sandbox is the boundary; this keeps tools to those places.
 */
export function containerPath(agent: Agent, p: unknown): string {
  if (typeof p !== 'string' || p === '') throw new Error('path is required');
  const abs = path.posix.normalize(p.startsWith('/') ? p : `/work/${p}`).replace(/(.)\/$/, '$1');
  if (abs === '/work' || abs.startsWith('/work/') || abs === '/skills' || abs.startsWith('/skills/')) return abs;
  const m = /^\/team\/([a-z0-9][a-z0-9-]{0,40})(\/|$)/.exec(abs);
  if (!m) throw new Error(`path outside workspace: ${p}`);
  if (!agent.teams?.includes(m[1])) throw new Error(`not a member of team ${m[1]}`);
  return abs;
}
/** Workspace files are shown relative to /work; team files keep their /team/<id>/ prefix. */
export const shown = (p: string) => p.startsWith('/work/') ? p.slice('/work/'.length) : p;

/** One tool call. Failures come back as "ERROR: ..." text so the model can react; cancellation propagates. */
export async function runTool(agent: Agent, name: string, rawArgs: string, signal: AbortSignal, env: { files: Files; exec: ExecFn }): Promise<string> {
  try {
    if (!agent.tools.includes(name)) throw new Error(`tool not allowed for this agent: ${name}`);
    const args = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
    switch (name) {
      case 'sandbox_list_files': {
        return clip((await env.files.list(agent, containerPath(agent, String(args.dir ?? '.')))).map(shown).join('\n') || '(no files)');
      }
      case 'sandbox_read_file': {
        return clip((await env.files.read(agent, containerPath(agent, args.path), 1_000_000)).toString('utf8'));
      }
      case 'sandbox_write_file': {
        if (typeof args.content !== 'string') throw new Error('content must be a string');
        await env.files.write(agent, containerPath(agent, args.path), args.content);
        return `wrote ${String(args.path)}`;
      }
      case 'sandbox_edit_file': {
        const file = containerPath(agent, args.path);
        if (typeof args.old_text !== 'string' || !args.old_text) throw new Error('old_text must be a non-empty string');
        if (typeof args.new_text !== 'string') throw new Error('new_text must be a string');
        const text = (await env.files.read(agent, file, 1_000_000)).toString('utf8');
        const count = text.split(args.old_text).length - 1;
        if (count === 0) throw new Error('old_text not found in the file');
        if (count > 1 && args.replace_all !== true) throw new Error(`old_text appears ${count} times: add surrounding lines to make it unique, or set replace_all`);
        await env.files.write(agent, file, text.split(args.old_text).join(args.new_text));
        const n = args.replace_all === true ? count : 1;
        return `edited ${String(args.path)} (${n} place${n > 1 ? 's' : ''})`;
      }
      case 'sandbox_search': {
        if (typeof args.pattern !== 'string' || !args.pattern) throw new Error('pattern must be a non-empty string');
        return clip((await env.files.search(agent, containerPath(agent, String(args.dir ?? '.')), args.pattern)).map(shown).join('\n') || '(no matches)');
      }
      case 'web_fetch': {
        if (!agent.sandbox.network) throw new Error('this agent has no internet access (turn it on in the agent settings)');
        if (typeof args.url !== 'string' || !/^https?:\/\//.test(args.url)) throw new Error('url must start with http:// or https://');
        return clip(await env.files.fetchText(agent, args.url) || '(empty page)');
      }
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
