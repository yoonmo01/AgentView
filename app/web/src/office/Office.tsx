import { MapControls, OrthographicCamera } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3, type Group } from 'three';
import { LABEL, displayStatus, type OfficeState, type Status } from './state.ts';

/** Mirrors GET /api/agents. */
export type AgentInfo = { id: string; name: string; role: string; avatar: { model: string; color: string } };
type Vec3 = [number, number, number];

// ponytail: fixed 4-column desk grid; team rooms from layout.json arrive with stage 4
const deskAt = (i: number): Vec3 => [(i % 4) * 2.4 - 3.6, 0, Math.floor(i / 4) * 2.4 - 1.2];
const SEAT_OFFSET = 0.6;
const LABEL_HEIGHT = 1.15;
const projected = new Vector3();

function Desk({ at, active }: { at: Vec3; active: boolean }) {
  return (
    <group position={at}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.06, 0.65]} />
        <meshStandardMaterial color="#c9a27e" />
      </mesh>
      {[-0.58, 0.58].map((x) => (
        <mesh key={x} position={[x, 0.235, 0]} castShadow>
          <boxGeometry args={[0.06, 0.47, 0.6]} />
          <meshStandardMaterial color="#a8825f" />
        </mesh>
      ))}
      <mesh position={[0, 0.72, -0.2]} castShadow>
        <boxGeometry args={[0.56, 0.36, 0.04]} />
        <meshStandardMaterial color="#2b2b2b" emissive={active ? '#58a6ff' : '#000000'} emissiveIntensity={active ? 0.9 : 0} />
      </mesh>
    </group>
  );
}

function Character({ agent, home, status, selected, onSelect, label }: {
  agent: AgentInfo; home: Vec3; status: Status; selected: boolean; onSelect: (id: string) => void;
  label: () => HTMLDivElement | undefined;
}) {
  const ref = useRef<Group>(null);
  const seat = { x: home[0], z: home[2] + SEAT_OFFSET };
  const goal = useRef({ x: seat.x, z: seat.z, until: 0 });
  useEffect(() => { ref.current?.position.set(seat.x, 0, seat.z); }, []);

  useFrame(({ clock, camera, size }, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    if (status !== 'idle') goal.current = { ...seat, until: 0 };
    else if (t > goal.current.until) {
      // idle wander near the desk: decoration only, never a work animation
      goal.current = { x: seat.x + (Math.random() - 0.5) * 2, z: seat.z + Math.random() * 1.2, until: t + 3 + Math.random() * 3 };
    }
    const dx = goal.current.x - g.position.x;
    const dz = goal.current.z - g.position.z;
    const dist = Math.hypot(dx, dz);
    const walking = dist > 0.03;
    if (walking) {
      const step = Math.min(dist, dt * 1.4);
      g.position.x += (dx / dist) * step;
      g.position.z += (dz / dist) * step;
      g.rotation.y = Math.atan2(dx, dz);
    } else if (status !== 'idle') {
      g.rotation.y = Math.PI; // face the desk
    }
    g.position.y = walking ? Math.abs(Math.sin(t * 10)) * 0.05
      : status === 'typing' ? Math.abs(Math.sin(t * 18)) * 0.03
      : status === 'thinking' || status === 'reading' ? Math.sin(t * 3) * 0.02
      : status === 'done' ? Math.max(0, Math.sin(t * 6)) * 0.15
      : 0;

    // Name tags are plain DOM over the canvas; move them to the character's screen position each frame.
    const el = label();
    if (el) {
      projected.set(g.position.x, g.position.y + LABEL_HEIGHT, g.position.z).project(camera);
      el.style.transform = `translate(${((projected.x + 1) / 2) * size.width}px, ${((1 - projected.y) / 2) * size.height}px) translate(-50%, -50%)`;
    }
  });

  return (
    <group ref={ref} onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}>
      <mesh position={[0, 0.36, 0]} castShadow>
        <capsuleGeometry args={[0.17, 0.32, 4, 12]} />
        <meshStandardMaterial color={status === 'error' ? '#d9534f' : agent.avatar.color} />
      </mesh>
      <mesh position={[0, 0.84, 0]} castShadow>
        <sphereGeometry args={[0.16, 20, 16]} />
        <meshStandardMaterial color="#ffe0bd" />
      </mesh>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.26, 0.32, 32]} />
          <meshBasicMaterial color="#f0b400" />
        </mesh>
      )}
    </group>
  );
}

export function Office({ agents, state, now, selected, onSelect }: {
  agents: AgentInfo[]; state: OfficeState; now: number; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const labels = useRef(new Map<string, HTMLDivElement>());
  const statusOf = (id: string) => displayStatus(state.agents[id], now);
  return (
    <>
      <Canvas shadows onPointerMissed={() => onSelect(null)}>
        <OrthographicCamera makeDefault position={[8, 9, 10]} zoom={70} />
        <MapControls enableRotate={false} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 10, 6]} intensity={1.1} castShadow />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[14, 10]} />
          <meshStandardMaterial color="#e8e2d6" />
        </mesh>
        {agents.map((a, i) => (
          <group key={a.id}>
            <Desk at={deskAt(i)} active={statusOf(a.id) === 'typing'} />
            <Character agent={a} home={deskAt(i)} status={statusOf(a.id)} selected={selected === a.id} onSelect={onSelect}
              label={() => labels.current.get(a.id)} />
          </group>
        ))}
      </Canvas>
      {agents.map((a) => (
        <div key={a.id} className={`tag tag-${statusOf(a.id)}`}
          ref={(el) => { if (el) labels.current.set(a.id, el); else labels.current.delete(a.id); }}>
          {a.name} · {LABEL[statusOf(a.id)]}
        </div>
      ))}
    </>
  );
}
