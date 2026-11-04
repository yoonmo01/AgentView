import { MapControls, OrthographicCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { AgentDef, TeamDef } from '../api.ts';
import { Character, placeLabel, type Mode } from './Character.tsx';
import { Building, DeskSet } from './Furniture.tsx';
import { center, FLOOR, LOBBY, LOBBY_DESKS, LOUNGE, MEETING, meetingSeat, placeAgents, ROOMS, roomDesks, SEAT, TALL, teamRoom } from './layout.ts';
import { buildGrid } from './nav.ts';
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
function FitView() {
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
    for (const x of [FLOOR.x0, FLOOR.x1]) for (const z of [FLOOR.z0, FLOOR.z1]) for (const y of [0, TALL]) {
      const p = new Vector3(x, y, z);
      x0 = Math.min(x0, p.dot(right)); x1 = Math.max(x1, p.dot(right)); y0 = Math.min(y0, p.dot(up)); y1 = Math.max(y1, p.dot(up));
    }
    const shift = right.multiplyScalar((x0 + x1) / 2).add(up.multiplyScalar((y0 + y1) / 2)); // screen-center of the floor
    camera.position.add(shift);
    target.target.copy(shift);
    camera.zoom = 0.94 * Math.min(size.width / (x1 - x0), size.height / (y1 - y0));
    camera.updateProjectionMatrix();
    target.update?.();
  }, [camera, controls, size.width, size.height]);
  return null;
}

/** Keeps a fixed-position DOM label (room names) over its 3D point. */
function Anchor({ x, z, el }: { x: number; z: number; el: () => HTMLDivElement | undefined }) {
  useFrame(({ camera, size }) => { const e = el(); if (e) placeLabel(e, x, 0.1, z, camera, size); });
  return null;
}

export function Office({ agents, teams, state, now, selected, onSelect, onSelectTeam }: {
  agents: AgentDef[]; teams: TeamDef[]; state: OfficeState; now: number; selected: string | null;
  onSelect: (id: string | null) => void; onSelectTeam?: (teamId: string) => void;
}) {
  const labels = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, Vector3>()).current;
  const places = useMemo(() => placeAgents(agents, teams), [agents, teams]);
  const statusOf = (id: string) => displayStatus(state.agents[id], now);
  const lobbyCount = [...places.values()].filter((p) => !p.room).length;
  const debates = Object.values(state.runs).filter((r) => r.live && r.pattern === 'debate');
  const activeDesks = new Set(agents.filter((a) => statusOf(a.id) === 'typing').map((a) => { const d = places.get(a.id)!.desk; return `${d.x},${d.z}`; }));
  const lobbyDesks = Math.max(4, Math.min(lobbyCount, LOBBY_DESKS.length));
  const desks = useMemo(() => [...Array.from({ length: ROOMS }, (_, i) => roomDesks(i + 1)).flat(), ...LOBBY_DESKS.slice(0, lobbyDesks)], [lobbyDesks]);
  const grid = useMemo(() => buildGrid(desks), [desks]);
  const rooms = [
    ...Array.from({ length: ROOMS }, (_, i) => {
      const r = teamRoom(i + 1);
      const team = teams.find((t) => t.room === i + 1);
      return { key: `room${i + 1}`, x: center(r).x, z: r.z0 + 0.45, text: `${i + 1}번 방 · ${team ? team.name : '빈 방'}`, team: team?.id };
    }),
    { key: 'lobby', x: center(LOBBY).x, z: LOBBY.z1 - 0.4, text: '로비', team: undefined },
    { key: 'meeting', x: center(MEETING).x, z: MEETING.z1 - 0.45, text: '회의실', team: undefined },
    { key: 'lounge', x: center(LOUNGE).x, z: LOUNGE.z1 - 0.4, text: '휴게실', team: undefined },
  ];
  const ref = (key: string) => (el: HTMLElement | null) => { if (el) labels.current.set(key, el as HTMLDivElement); else labels.current.delete(key); };

  return (
    <>
      <Canvas shadows onPointerMissed={() => onSelect(null)}>
        <OrthographicCamera makeDefault position={[10, 16, 18]} zoom={36} />
        <MapControls makeDefault enableRotate={false} />
        <FitView />
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 14, 8]} intensity={1.2} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={12} shadow-camera-bottom={-12} />
        <Building teams={teams} />
        {desks.map((d) => <DeskSet key={`${d.x},${d.z}`} at={d} active={activeDesks.has(`${d.x},${d.z}`)} />)}
        {agents.map((a) => {
          const place = places.get(a.id)!;
          const seat = { x: place.desk.x, z: place.desk.z - SEAT };
          const debate = debates.find((r) => r.agents.includes(a.id));
          const status = statusOf(a.id);
          const mode: Mode = debate ? 'meeting' : status === 'idle' ? 'idle' : 'work';
          const goal = debate ? meetingSeat(debate.agents.indexOf(a.id)) : seat;
          const face = debate ? Math.atan2(center(MEETING).x - goal.x, center(MEETING).z - goal.z) : 0;
          return (
            <Character key={a.id} agent={a} seat={seat} goal={goal} face={face} mode={mode} status={status}
              selected={selected === a.id} onSelect={onSelect} label={() => labels.current.get(a.id)} positions={positions} grid={grid} />
          );
        })}
        <Links links={state.links} positions={positions} />
        {rooms.map((r) => <Anchor key={r.key} x={r.x} z={r.z} el={() => labels.current.get(r.key)} />)}
      </Canvas>
      {rooms.map((r) => r.team && onSelectTeam
        ? <button key={r.key} className="tag room-tag clickable" ref={ref(r.key)} onClick={() => onSelectTeam(r.team!)} title="이 팀과 대화">{r.text}</button>
        : <div key={r.key} className="tag room-tag" ref={ref(r.key)}>{r.text}</div>)}
      {agents.map((a) => {
        const s = statusOf(a.id);
        const say = s !== 'idle' && s !== 'done' && state.agents[a.id]?.say;
        return (
          <div key={a.id} className="agent-label" ref={ref(a.id)}>
            {say && <div className="bubble" style={{ borderColor: COLOR[s] }}>{say}</div>}
            <div className={`tag${selected === a.id ? ' tag-selected' : ''}`} title={`${a.name} · ${LABEL[s]}`}>
              <span className="dot" style={{ background: COLOR[s] }} aria-hidden /> {a.name}
              {s !== 'idle' && <small> {LABEL[s]}</small>}
            </div>
          </div>
        );
      })}
    </>
  );
}
