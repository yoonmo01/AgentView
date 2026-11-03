import { useEffect, useReducer } from 'react';
import { apply, initial, type AgUiEvent, type OfficeState } from './state.ts';

type Msg = { runId: string; seq: number; event: AgUiEvent; now: number };
const reduce = (s: OfficeState, m: Msg) => apply(s, m.runId, m.seq, m.event, m.now);

/** Live office (all runs) or the replay of one run (`?run=<id>`). */
export function useOffice(runId: string | null): OfficeState {
  const [state, dispatch] = useReducer(reduce, initial);
  useEffect(() => {
    const es = new EventSource(runId ? `/api/runs/${encodeURIComponent(runId)}/events` : '/api/events');
    es.onmessage = (m) => {
      const event = JSON.parse(m.data) as AgUiEvent;
      const [a, b] = m.lastEventId.split(':'); // "/events" sends "runId:seq"; a single run sends "seq"
      dispatch({ runId: b === undefined ? runId! : a, seq: Number(b ?? a), event, now: Date.now() });
      if (runId && (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR')) es.close();
    };
    return () => es.close();
  }, [runId]);
  return state;
}
