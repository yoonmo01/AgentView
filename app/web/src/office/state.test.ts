import { describe, expect, it } from 'vitest';
import { apply, displayStatus, initial, type AgUiEvent, type OfficeState } from './state.ts';

const feed = (events: AgUiEvent[], runId = 'r1', start: OfficeState = initial) =>
  events.reduce<OfficeState>((s, e, i) => apply(s, runId, i, e, 1000), start);
const info = (main: string): AgUiEvent => ({ type: 'CUSTOM', name: 'agentview.run_info', value: { main } });

describe('office state', () => {
  it('follows the main agent through a tool call to done, then idles', () => {
    let s = feed([{ type: 'RUN_STARTED' }, info('nova')]);
    expect(s.agents.nova.status).toBe('thinking');
    s = apply(s, 'r1', 2, { type: 'TOOL_CALL_START', toolCallName: 'sandbox_run' }, 1000);
    expect(s.agents.nova).toMatchObject({ status: 'typing', tool: 'sandbox_run' });
    s = apply(s, 'r1', 3, { type: 'TOOL_CALL_RESULT' }, 1000);
    expect(s.agents.nova.status).toBe('thinking');
    s = apply(s, 'r1', 4, { type: 'RUN_FINISHED' }, 2000);
    expect(displayStatus(s.agents.nova, 3000)).toBe('done');
    expect(displayStatus(s.agents.nova, 8000)).toBe('idle');
  });

  it('shows reading for tools that do not write', () => {
    expect(feed([info('nova'), { type: 'TOOL_CALL_START', toolCallName: 'sandbox_read_file' }]).agents.nova.status).toBe('reading');
  });

  it('ignores duplicate or older events', () => {
    const s = feed([info('nova')]);
    expect(apply(s, 'r1', 0, { type: 'TOOL_CALL_START', toolCallName: 'sandbox_run' }, 1)).toBe(s);
  });

  it('attributes subagent events to the subagent, not the main agent', () => {
    const s = feed([
      info('atlas'),
      { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'nova' },
      { type: 'TOOL_CALL_START', toolCallName: 'sandbox_write_file', subagentRunId: 's1' },
    ]);
    expect(s.agents.nova.status).toBe('typing');
    expect(s.agents.atlas.status).toBe('thinking');
  });

  it('marks everyone still working in a failed run as error', () => {
    const s = feed([info('atlas'), { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'nova' }, { type: 'RUN_ERROR', message: 'x' }]);
    expect(s.agents.atlas.status).toBe('error');
    expect(s.agents.nova.status).toBe('error');
  });

  it('tracks delegation links and the live team run until it ends', () => {
    const team: AgUiEvent = { type: 'CUSTOM', name: 'agentview.run_info', value: { main: 'atlas', pattern: 'debate', agents: [{ id: 'atlas' }, { id: 'nova' }] } };
    const mid = feed([
      team,
      { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'nova' },
      { type: 'SUBAGENT_STARTED', subagentRunId: 's2', name: 'team:inner' }, // teams are not drawn
    ]);
    expect(mid.links).toEqual({ 'r1/s1': { from: 'atlas', to: 'nova' } });
    expect(mid.runs.r1).toMatchObject({ pattern: 'debate', agents: ['atlas', 'nova'], live: true });
    const done = feed([team, { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'nova' }, { type: 'SUBAGENT_FINISHED', subagentRunId: 's1' }]);
    expect(done.links).toEqual({});
    const ended = feed([team, { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'nova' }, { type: 'RUN_FINISHED' }]);
    expect(ended.links).toEqual({});
    expect(ended.runs.r1.live).toBe(false);
  });

  it('keeps a live line of what the agent is saying or doing', () => {
    const s = feed([
      info('nova'),
      { type: 'TEXT_MESSAGE_START', messageId: 'm' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Let me write ' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'the file.' },
    ]);
    expect(s.agents.nova).toMatchObject({ status: 'thinking', say: 'Let me write the file.' });
    const t = feed([
      info('nova'),
      { type: 'TOOL_CALL_START', toolCallId: 't', toolCallName: 'sandbox_run' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 't', delta: '{"command":"python hi.py"}' },
    ]);
    expect(t.agents.nova).toMatchObject({ status: 'typing', say: '실행: python hi.py' });
  });

  it('shows agents waiting for another run as queued', () => {
    expect(feed([{ type: 'CUSTOM', name: 'agentview.queued', value: { agentId: 'nova' } }]).agents.nova.status).toBe('queued');
  });

  it('shows a wait for a sandbox slot, then work again', () => {
    const waiting = feed([{ type: 'CUSTOM', name: 'agentview.queued', value: { agentId: 'nova', reason: 'sandbox' } }]);
    expect(waiting.agents.nova).toMatchObject({ status: 'queued', say: '샌드박스 자리가 나길 기다리는 중' });
    expect(feed([{ type: 'CUSTOM', name: 'agentview.queued', value: { agentId: 'nova', reason: 'sandbox' } },
      { type: 'CUSTOM', name: 'agentview.resumed', value: { agentId: 'nova' } }]).agents.nova.status).toBe('reading');
  });
});
