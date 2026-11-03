import { MapControls, OrthographicCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, type Vector3 } from 'three';
import type { AgentDef, TeamDef } from '../api.ts';
import { Character, placeLabel, type Mode } from './Character.tsx';
import { Building, DeskSet } from './Furniture.tsx';
import { center, LOBBY, LOBBY_DESKS, LOUNGE, MEETING, meetingSeat, placeAgents, ROOMS, roomDesks, SEAT, teamRoom } from './layout.ts';
import { LABEL, displayStatus, type OfficeState } from './state.ts';

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

/** Fit the whole floor in the canvas whenever its size changes (the user can still zoom afterwards). */
function FitZoom() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.zoom = Math.min(size.width / 25, size.height / 19);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

/** Keeps a fixed-position DOM label (room names) over its 3D point. */
function Anchor({ x, z, el }: { x: number; z: number; el: () => HTMLDivElement | undefined }) {
  useFrame(({ camera, size }) => { const e = el(); if (e) placeLabel(e, x, 0.1, z, camera, size); });
  return null;
}

export function Office({ agents, teams, state, now, selected, onSelect }: {
  agents: AgentDef[]; teams: TeamDef[]; state: OfficeState; now: number; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const labels = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, Vector3>()).current;
  const places = useMemo(() => placeAgents(agents, teams), [agents, teams]);
  const statusOf = (id: string) => displayStatus(state.agents[id], now);
  const lobbyCount = [...places.values()].filter((p) => !p.room).length;
  const debates = Object.values(state.runs).filter((r) => r.live && r.pattern === 'debate');
  const activeDesks = new Set(agents.filter((a) => statusOf(a.id) === 'typing').map((a) => { const d = places.get(a.id)!.desk; return `${d.x},${d.z}`; }));
  const desks = [...Array.from({ length: ROOMS }, (_, i) => roomDesks(i + 1)).flat(), ...LOBBY_DESKS.slice(0, Math.max(4, Math.min(lobbyCount, LOBBY_DESKS.length)))];
  const rooms = [
    ...Array.from({ length: ROOMS }, (_, i) => {
      const r = teamRoom(i + 1);
      const team = teams.find((t) => t.room === i + 1);
      return { key: `room${i + 1}`, x: center(r).x, z: r.z1 - 0.35, text: `${i + 1}번 방 · ${team ? team.name : '빈 방'}` };
    }),
    { key: 'lobby', x: center(LOBBY).x, z: LOBBY.z1 - 0.4, text: '로비' },
    { key: 'meeting', x: center(MEETING).x, z: MEETING.z0 + 0.5, text: '회의실' },
    { key: 'lounge', x: center(LOUNGE).x, z: LOUNGE.z1 - 0.4, text: '휴게실' },
  ];

  return (
    <>
      <Canvas shadows onPointerMissed={() => onSelect(null)}>
        <OrthographicCamera makeDefault position={[10, 16, 18]} zoom={36} />
        <FitZoom />
        <MapControls enableRotate={false} />
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
              selected={selected === a.id} onSelect={onSelect} label={() => labels.current.get(a.id)} positions={positions} />
          );
        })}
        <Links links={state.links} positions={positions} />
        {rooms.map((r) => <Anchor key={r.key} x={r.x} z={r.z} el={() => labels.current.get(r.key)} />)}
      </Canvas>
      {rooms.map((r) => (
        <div key={r.key} className="tag room-tag" ref={(el) => { if (el) labels.current.set(r.key, el); else labels.current.delete(r.key); }}>{r.text}</div>
      ))}
      {agents.map((a) => (
        <div key={a.id} className={`tag tag-${statusOf(a.id)}`}
          ref={(el) => { if (el) labels.current.set(a.id, el); else labels.current.delete(a.id); }}>
          {a.name} · {LABEL[statusOf(a.id)]}
        </div>
      ))}
    </>
  );
}
