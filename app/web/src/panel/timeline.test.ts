import { expect, it } from 'vitest';
import { timeline, writtenFiles } from './timeline.ts';

const events = [
  { type: 'RUN_STARTED', timestamp: 0 },
  { type: 'CUSTOM', name: 'agentview.run_info', value: { main: 'nova' }, timestamp: 1 },
  { type: 'TEXT_MESSAGE_START', messageId: 'm1', timestamp: 2 },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Writing ', timestamp: 3 },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'it.', timestamp: 4 },
  { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'sandbox_write_file', timestamp: 10 },
  { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"path":"/work/a.py","content":"x"}', timestamp: 11 },
  { type: 'TOOL_CALL_RESULT', toolCallId: 't1', content: 'wrote a.py', timestamp: 40 },
  { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'milo', timestamp: 50 },
  { type: 'TOOL_CALL_START', subagentRunId: 's1', toolCallId: 't2', toolCallName: 'sandbox_run', timestamp: 51 },
  { type: 'SUBAGENT_FINISHED', subagentRunId: 's1', timestamp: 60 },
  { type: 'RUN_FINISHED', timestamp: 70 },
];

it('keeps the main agent events and leaves out subagent ones', () => {
  const items = timeline(events, 'nova');
  expect(items.map((i) => i.kind)).toEqual(['run', 'text', 'tool', 'run']);
  expect(items[1]).toMatchObject({ text: 'Writing it.' });
  expect(items[2]).toMatchObject({ name: 'sandbox_write_file', result: 'wrote a.py', ms: 30 });
  expect([...writtenFiles(items)]).toEqual(['a.py']);
});

it('follows a subagent by its subagentRunId', () => {
  const items = timeline(events, 'milo');
  expect(items.map((i) => (i.kind === 'tool' ? i.name : i.kind === 'run' ? i.text : i.kind))).toEqual(
    ['실행 시작', '맡은 작업 시작', 'sandbox_run', '맡은 작업 완료', '실행 완료']);
});
