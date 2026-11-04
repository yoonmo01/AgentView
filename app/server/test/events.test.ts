import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBus, type Ev } from '../src/events.ts';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'av-bus-'));
const types = (evs: Ev[]) => evs.map((e) => e.type);

describe('event bus', () => {
  it('appends events to JSONL and replays a finished run, then ends', () => {
    const dir = tmp();
    const bus = createBus(dir);
    bus.emit('r1', { type: 'RUN_STARTED' });
    bus.emit('r1', { type: 'TEXT_MESSAGE_START' });
    bus.emit('r1', { type: 'RUN_FINISHED' });
    expect(readFileSync(path.join(dir, 'r1.jsonl'), 'utf8').trim().split('\n')).toHaveLength(3);

    const got: Ev[] = [];
    let ended = false;
    bus.follow('r1', -1, (_seq, e) => got.push(e), () => { ended = true; });
    expect(types(got)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'RUN_FINISHED']);
    expect(ended).toBe(true);
  });

  it('follows a live run without gaps or duplicates and resumes after a seq', () => {
    const bus = createBus(tmp());
    bus.emit('r2', { type: 'RUN_STARTED' });
    const got: number[] = [];
    let ended = false;
    bus.follow('r2', -1, (seq) => got.push(seq), () => { ended = true; });
    bus.emit('r2', { type: 'TEXT_MESSAGE_START' });
    expect(got).toEqual([0, 1]);
    expect(ended).toBe(false);

    const resumed: number[] = [];
    bus.follow('r2', 0, (seq) => resumed.push(seq), () => {});
    bus.emit('r2', { type: 'RUN_ERROR', message: 'x' });
    expect(got).toEqual([0, 1, 2]);
    expect(ended).toBe(true);
    expect(resumed).toEqual([1, 2]);
  });

  it('ends at once when resuming a finished run with nothing newer', () => {
    const bus = createBus(tmp());
    bus.emit('r5', { type: 'RUN_STARTED' });
    bus.emit('r5', { type: 'RUN_FINISHED' });
    let ended = false;
    const got: number[] = [];
    bus.follow('r5', 1, (seq) => got.push(seq), () => { ended = true; });
    expect(got).toEqual([]);
    expect(ended).toBe(true);
  });

  it('waits for a run that has not started yet', () => {
    const bus = createBus(tmp());
    const got: number[] = [];
    bus.follow('r3', -1, (seq) => got.push(seq), () => {});
    bus.emit('r3', { type: 'RUN_STARTED' });
    expect(got).toEqual([0]);
  });

  it('followAll replays only in-progress runs, then streams everything', () => {
    const bus = createBus(tmp());
    bus.emit('done', { type: 'RUN_STARTED' });
    bus.emit('done', { type: 'RUN_FINISHED' });
    bus.emit('busy', { type: 'RUN_STARTED' });
    const got: string[] = [];
    bus.followAll((id, seq) => got.push(`${id}:${seq}`));
    bus.emit('busy', { type: 'TEXT_MESSAGE_START' });
    expect(got).toEqual(['busy:0', 'busy:1']);
    expect(bus.list().map((r) => [r.runId, r.live]).sort()).toEqual([['busy', true], ['done', false]]);
  });

  it('rejects run ids that could escape the folder', () => {
    const bus = createBus(tmp());
    expect(() => bus.emit('../x', { type: 'RUN_STARTED' })).toThrow('invalid run id');
    expect(bus.exists('../x')).toBe(false);
  });
});
