import { MapControls, OrthographicCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { AgentDef, TeamDef } from '../api.ts';
import { Character, placeLabel, type Mode } from './Character.tsx';
import { Building, DeskSet } from './Furniture.tsx';
import { PATTERN_LABEL } from '../api.ts';
import { assignLobby, buildFloor, center, seatAt, TALL, type Rect, type Seat } from './layout.ts';
import { buildGrid } from './nav.ts';
import { Chip } from '../shell/ui.tsx';
import { COLOR, LABEL, displayStatus, type OfficeState } from './state.ts';

const MAX_LINKS = 64;

/** Delegation lines (main → subagent) above the characters while the subagent works. */
function Links({ links, positions }: { links: OfficeState['links']; positions: Map<string, Vector3> }) {
  const geo = useMemo(() => new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(MAX_LINKS * 6), 3)), []);
  const list = Object.values(links);
  useFrame(() => {
    const arr = geo.attributes.position.array as Float32Array;
    let n = 0;
    for (const l of list) {
      const a = positions.get(l.from);
      const b = positions.get(l.to);
      if (!a || !b || n >= MAX_LINKS) continue;
      arr.set([a.x, 1.35, a.z, b.x, 1.35, b.z], n++ * 6);
    }
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true;
  });
  return <lineSegments geometry={geo} frustumCulled={false}><lineBasicMaterial color="#f0b400" /></lineSegments>;
}

/** Center and fit the whole floor (with its tall walls) whenever the canvas size changes; the user can still pan and zoom. */
function FitView({ b }: { b: Rect }) {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    const target = (controls as unknown as { target?: Vector3; update?: () => void } | null);
    if (!target?.target) return;
    camera.position.sub(target.target); // back to looking at the origin
    target.target.set(0, 0, 0);
    camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [0, TALL]) {
      const p = new Vector3(x, y, z);
      x0 = Math.min(x0, p.dot(right)); x1 = Math.max(x1, p.dot(right)); y0 = Math.min(y0, p.dot(up)); y1 = Math.max(y1, p.dot(up));
    }
    const shift = right.multiplyScalar((x0 + x1) / 2).add(up.multiplyScalar((y0 + y1) / 2)); // screen-center of the floor
    camera.position.add(shift);
    target.target.copy(shift);
    camera.zoom = 0.94 * Math.min(size.width / (x1 - x0), size.height / (y1 - y0));
    camera.updateProjectionMatrix();
    target.update?.();
  }, [camera, controls, size.width, size.height, b.x0, b.x1, b.z0, b.z1]);
  return null;
}

/** Keeps a fixed-position DOM label (room names) over its 3D point. */
function Anchor({ x, z, el }: { x: number; z: number; el: () => HTMLDivElement | undefined }) {
  useFrame(({ camera, size }) => { const e = el(); if (e) placeLabel(e, x, 0.1, z, camera, size); });
  return null;
}

export function Office({ agents, teams, state, now, selected, selectedTeam, onSelect, onSelectTeam }: {
  agents: AgentDef[]; teams: TeamDef[]; state: OfficeState; now: number; selected: string | null; selectedTeam?: string | null;
  onSelect: (id: string | null) => void; onSelectTeam?: (teamId: string) => void;
}) {
  const labels = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, Vector3>()).current;
  const floor = useMemo(() => buildFloor(teams, agents), [teams, agents]);
  const grid = useMemo(() => buildGrid(floor), [floor]);
  const roomOf = useMemo(() => new Map(floor.rooms.map((r) => [r.team.id, r])), [floor]);
  const statusOf = (id: string) => displayStatus(state.agents[id], now);
  // where each agent works: its own seat in the room of the team it is working for, else a shared lobby desk
  const teamSeat = (id: string): { seat: Seat; main: boolean } | undefined => {
    const run = state.runs[state.agents[id]?.runId ?? ''];
    const ids = [run?.target?.startsWith('team:') ? run.target.slice('team:'.length) : '', ...(run?.teams ?? [])];
    for (const t of ids) { const r = roomOf.get(t); const seat = r?.seats.get(id); if (seat) return { seat, main: r!.team.main === id }; }
  };
  const picked = teams.find((t) => t.id === selectedTeam);
  const ringOf = (id: string) => selected === id ? '#f0b400' : picked && (picked.main === id || picked.members.includes(id)) ? picked.color || '#26231f' : null;
  const busy = agents.filter((a) => statusOf(a.id) !== 'idle');
  const lobby = useRef(new Map<string, number>());
  lobby.current = assignLobby(lobby.current, busy.filter((a) => !teamSeat(a.id)).map((a) => a.id), floor.lobbyDesks.length);
  const waiting = busy.filter((a) => !teamSeat(a.id) && !lobby.current.has(a.id)).map((a) => a.id);
  /** the seat an agent works at now, or undefined while it waits for a lobby desk */
  const seatOf = (id: string): Seat | undefined => teamSeat(id)?.seat ?? (lobby.current.has(id) ? seatAt(floor.lobbyDesks[lobby.current.get(id)!]) : undefined);
  const activeDesks = new Set(agents.filter((a) => statusOf(a.id) === 'typing').map((a) => seatOf(a.id)?.desk));
  const desks = [...floor.lobbyDesks, ...floor.rooms.flatMap((r) => r.desks)];
  const rooms = [
    ...floor.rooms.map((r) => ({ key: `room-${r.team.id}`, x: center(r.rect).x, z: r.rect.z1 - 0.35, text: `${r.team.name} · ${PATTERN_LABEL[r.team.pattern]}`, team: r.team.id, color: r.team.color })),
    { key: 'lobby', x: center(floor.lobby).x, z: floor.lobby.z1 - 0.4, text: '로비', team: undefined, color: undefined },
    { key: 'meeting', x: center(floor.meeting).x, z: floor.meeting.z1 - 0.45, text: '회의실', team: undefined, color: undefined },
    { key: 'lounge', x: center(floor.lounge).x, z: floor.lounge.z1 - 0.4, text: '휴게실', team: undefined, color: undefined },
  ];
  const ref = (key: string) => (el: HTMLElement | null) => { if (el) labels.current.set(key, el as HTMLDivElement); else labels.current.delete(key); };

  return (
    <>
      <Canvas shadows onPointerMissed={() => onSelect(null)}>
        <OrthographicCamera makeDefault position={[10, 16, 18]} zoom={36} />
        <MapControls makeDefault enableRotate={false} />
        <FitView b={floor.bounds} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 14, 8]} intensity={1.2} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={floor.bounds.x0 - 3} shadow-camera-right={floor.bounds.x1 + 3} shadow-camera-top={14} shadow-camera-bottom={-14} />
        <Building floor={floor} />
        {desks.map((d) => <DeskSet key={`${d.x},${d.z}`} desk={d} active={activeDesks.has(d)} />)}
        {agents.map((a) => {
          const home = seatAt(floor.lobbyDesks[agents.indexOf(a) % floor.lobbyDesks.length]); // where idle strolls start
          const status = statusOf(a.id);
          const seat = status === 'idle' ? undefined : seatOf(a.id);
          const mode: Mode = status === 'idle' ? 'idle' : seat ? 'work' : 'wait';
          const goal = seat ?? (status === 'idle' ? home : floor.waitSpots[Math.max(0, waiting.indexOf(a.id)) % floor.waitSpots.length]);
          const face = seat?.face ?? 0;
          return (
            <Character key={a.id} agent={a} seat={home} goal={goal} face={face} mode={mode} status={status} lounge={floor.loungeSpots}
              ring={ringOf(a.id)} onSelect={onSelect} label={() => labels.current.get(a.id)} positions={positions} grid={grid} />
          );
        })}
        <Links links={state.links} positions={positions} />
        {rooms.map((r) => <Anchor key={r.key} x={r.x} z={r.z} el={() => labels.current.get(r.key)} />)}
      </Canvas>
      {rooms.map((r) => r.team && onSelectTeam
        ? <button key={r.key} className="tag room-tag clickable" ref={ref(r.key)} style={{ background: r.color || undefined }} onClick={() => onSelectTeam(r.team!)} title="이 팀과 대화">{r.text}</button>
        : <div key={r.key} className="tag room-tag" ref={ref(r.key)}>{r.text}</div>)}
      {agents.map((a) => {
        const s = statusOf(a.id);
        const say = s !== 'idle' && s !== 'done' && state.agents[a.id]?.say;
        return (
          <div key={a.id} className="agent-label" ref={ref(a.id)}>
            {say && <div className="bubble" style={{ borderColor: COLOR[s] }}>{say}</div>}
            <Chip status={s} />
            <div className={`tag${selected === a.id ? ' tag-selected' : ''}`} title={`${a.name} · ${LABEL[s]}`}>{s !== 'idle' && teamSeat(a.id)?.main && '★ '}{a.name}</div>
          </div>
        );
      })}
    </>
  );
}
