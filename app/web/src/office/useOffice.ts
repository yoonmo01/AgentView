import { useEffect, useReducer } from 'react';
import { apply, initial, type AgUiEvent, type OfficeState } from './state.ts';

type Msg = { runId: string; seq: number; event: AgUiEvent; now: number };
const reduce = (s: OfficeState, m: Msg) => apply(s, m.runId, m.seq, m.event, m.now);

/** Longest wait between two replayed events: a slow model call does not leave the screen still for a minute. */
export const MAX_GAP_MS = 3000;

/**
 * When each recorded event plays, in ms after the first: the recorded gaps divided by `speed`, each gap capped at MAX_GAP_MS.
 * Events without a timestamp play right after the one before.
 */
export function replayTimes(timestamps: (number | undefined)[], speed: number): number[] {
  let at = 0;
  let prev: number | undefined;
  return timestamps.map((t) => {
    if (prev !== undefined && t !== undefined) at += Math.min(Math.max(t - prev, 0), MAX_GAP_MS) / speed;
    if (t !== undefined) prev = t;
    return at;
  });
}

/**
 * Live office (all runs), or one recorded run played back at its recorded pace (`?run=<id>`, `&speed=2` for faster).
 * Playback needs no model calls, so a run can be shown again without spending tokens.
 */
export function useOffice(runId: string | null, speed = 1): OfficeState {
  const [state, dispatch] = useReducer(reduce, initial);
  useEffect(() => {
    const es = new EventSource(runId ? `/api/runs/${encodeURIComponent(runId)}/events` : '/api/events');
    const timers: ReturnType<typeof setTimeout>[] = [];
    let clock = 0; // replay ms of the last scheduled event
    let prev: number | undefined;
    es.onmessage = (m) => {
      const event = JSON.parse(m.data) as AgUiEvent & { timestamp?: number };
      const [a, b] = m.lastEventId.split(':'); // "/events" sends "runId:seq"; a single run sends "seq"
      if (!runId) return dispatch({ runId: a, seq: Number(b), event, now: Date.now() });
      if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') es.close();
      clock += replayTimes([prev, event.timestamp], speed)[1];
      if (event.timestamp !== undefined) prev = event.timestamp;
      timers.push(setTimeout(() => dispatch({ runId, seq: Number(a), event, now: Date.now() }), clock));
    };
    return () => { es.close(); timers.forEach(clearTimeout); };
  }, [runId, speed]);
  return state;
}
