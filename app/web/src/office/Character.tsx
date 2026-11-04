import { useFrame, type Camera } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3, type Group } from 'three';
import type { AgentDef } from '../api.ts';
import { LOUNGE_SPOTS, type Vec2 } from './layout.ts';
import { findPath, isFree, type Grid } from './nav.ts';
import type { Status } from './state.ts';

/** work: at the own desk · meeting: at a meeting-room seat · idle: free to wander. */
export type Mode = 'work' | 'meeting' | 'idle';

const projected = new Vector3();
/** Move a DOM label over a 3D point (labels are plain DOM over the canvas). */
export function placeLabel(el: HTMLElement, x: number, y: number, z: number, camera: Camera, size: { width: number; height: number }) {
  projected.set(x, y, z).project(camera);
  el.style.transform = `translate(${((projected.x + 1) / 2) * size.width}px, ${((1 - projected.y) / 2) * size.height}px) translate(-50%, -50%)`;
}

const SPEED = 1.6;
const SKIN = '#ffe0bd';

export function Character({ agent, seat, goal, face, mode, status, selected, onSelect, label, positions, grid }: {
  agent: AgentDef; seat: Vec2; goal: Vec2; face: number; mode: Mode; status: Status; selected: boolean;
  onSelect: (id: string) => void; label: () => HTMLDivElement | undefined; positions: Map<string, Vector3>; grid: Grid;
}) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const wander = useRef({ x: seat.x, z: seat.z, until: 0 });
  const route = useRef<{ key: string; points: Vec2[] }>({ key: '', points: [] });
  useEffect(() => { root.current?.position.set(seat.x, 0, seat.z); }, []);
  useEffect(() => { route.current.key = ''; }, [grid]); // furniture moved: plan again

  useFrame(({ clock, camera, size }, dt) => {
    const g = root.current;
    if (!g || !body.current || !armL.current || !armR.current || !legL.current || !legR.current) return;
    const t = clock.elapsedTime;
    let to = goal;
    if (mode === 'idle') {
      // decoration only: stroll near the desk or visit the lounge, never a work animation
      if (t > wander.current.until) {
        const lounge = Math.random() < 0.3 ? LOUNGE_SPOTS[Math.floor(Math.random() * LOUNGE_SPOTS.length)] : null;
        let p = lounge ?? seat;
        for (let n = 0; !lounge && n < 8; n++) { // a free spot near the desk
          const q = { x: seat.x + (Math.random() - 0.5) * 3, z: seat.z + (Math.random() - 0.5) * 3 };
          if (isFree(grid, q)) { p = q; break; }
        }
        wander.current = { ...p, until: t + (lounge ? 8 : 3) + Math.random() * 4 };
      }
      to = wander.current;
    }
    const key = `${to.x.toFixed(2)},${to.z.toFixed(2)}`;
    if (route.current.key !== key) route.current = { key, points: findPath(grid, { x: g.position.x, z: g.position.z }, to) };
    const pts = route.current.points;
    let walking = false;
    let budget = Math.min(dt, 0.1) * SPEED; // clamp: a paused tab must not teleport through a wall on resume
    while (pts.length && budget > 0) {
      const dx = pts[0].x - g.position.x;
      const dz = pts[0].z - g.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.02) { pts.shift(); continue; }
      const step = Math.min(dist, budget);
      g.position.x += (dx / dist) * step;
      g.position.z += (dz / dist) * step;
      g.rotation.y = Math.atan2(dx, dz);
      budget -= step;
      walking = true;
    }
    if (!walking && mode !== 'idle') {
      g.rotation.y = face;
    }
    const sitting = !walking && mode !== 'idle';
    const swing = walking ? Math.sin(t * 10) * 0.6 : 0;
    legL.current.rotation.x = sitting ? -1.45 : swing;
    legR.current.rotation.x = sitting ? -1.45 : -swing;
    const typing = status === 'typing' && sitting;
    armL.current.rotation.set(typing ? -1.1 + Math.sin(t * 22) * 0.15 : status === 'done' ? 0 : -swing, 0, status === 'done' ? 2.6 : 0);
    armR.current.rotation.set(typing ? -1.1 + Math.cos(t * 22) * 0.15 : status === 'done' ? 0 : swing, 0, status === 'done' ? -2.6 : 0);
    body.current.position.y = (sitting ? 0.12 : 0)
      + (walking ? Math.abs(Math.sin(t * 10)) * 0.04
        : status === 'done' ? Math.max(0, Math.sin(t * 6)) * 0.18
        : status === 'thinking' || status === 'reading' ? Math.sin(t * 3) * 0.02 : 0);
    body.current.rotation.z = status === 'thinking' ? Math.sin(t * 1.5) * 0.06 : 0;

    (positions.get(agent.id) ?? positions.set(agent.id, new Vector3()).get(agent.id)!).copy(g.position);
    const el = label();
    if (el) placeLabel(el, g.position.x, 1.55 + body.current.position.y, g.position.z, camera, size);
  });

  const color = status === 'error' ? '#d9534f' : agent.avatar.color;
  return (
    <group ref={root} onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}>
      <group ref={body}>
        {[-0.09, 0.09].map((x, i) => (
          <group key={x} ref={i ? legR : legL} position={[x, 0.38, 0]}>
            <mesh position={[0, -0.18, 0]} castShadow><capsuleGeometry args={[0.07, 0.22, 4, 8]} /><meshStandardMaterial color="#3d4250" /></mesh>
          </group>
        ))}
        <mesh position={[0, 0.58, 0]} castShadow><capsuleGeometry args={[0.18, 0.2, 4, 12]} /><meshStandardMaterial color={color} /></mesh>
        {[-0.25, 0.25].map((x, i) => (
          <group key={x} ref={i ? armR : armL} position={[x, 0.7, 0]}>
            <mesh position={[0, -0.14, 0]} castShadow><capsuleGeometry args={[0.055, 0.2, 4, 8]} /><meshStandardMaterial color={color} /></mesh>
          </group>
        ))}
        <mesh position={[0, 1.0, 0]} castShadow><sphereGeometry args={[0.22, 24, 18]} /><meshStandardMaterial color={SKIN} /></mesh>
        {[-0.075, 0.075].map((x) => (
          <mesh key={x} position={[x, 1.02, 0.2]}><sphereGeometry args={[0.028, 10, 8]} /><meshStandardMaterial color="#222222" /></mesh>
        ))}
        <mesh position={[0, 1.13, -0.02]} castShadow><sphereGeometry args={[0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.2]} /><meshStandardMaterial color="#4a3a2e" /></mesh>
      </group>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.3, 0.37, 32]} />
          <meshBasicMaterial color="#f0b400" />
        </mesh>
      )}
    </group>
  );
}
