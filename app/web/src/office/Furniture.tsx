import { useGLTF } from '@react-three/drei';
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { Box3, Vector3, type Mesh } from 'three';
import type { TeamDef } from '../api.ts';
import { center, DESK_SIZE, FLOOR, LOBBY, LOUNGE, MEETING, PROPS, ROOMS, SEAT, TALL, teamRoom, WALL_T, WALLS, type Rect, type Vec2 } from './layout.ts';

// Kenney Furniture Kit (CC0), installed separately into public/models/furniture (see README).
const BASE = '/models/furniture/kenney_furniture-kit/Models/GLTF format/';
const KENNEY_SCALE = 2; // the kit is modelled at about half real size
type V3 = [number, number, number];

class OrBox extends Component<{ box: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.box : this.props.children; }
}

function Loaded({ name }: { name: string }) {
  const { scene } = useGLTF(encodeURI(`${BASE}${name}.glb`));
  const obj = useMemo(() => {
    const o = scene.clone(true);
    const box = new Box3().setFromObject(o);
    const c = box.getCenter(new Vector3());
    o.position.set(-c.x, -box.min.y, -c.z); // center on the footprint, stand on the floor
    o.traverse((m) => { if ((m as Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return o;
  }, [scene]);
  return <group scale={KENNEY_SCALE}><primitive object={obj} /></group>;
}

/** A Kenney model (front faces +z), or a plain box of `size` when the asset files are missing. */
export function Model({ name, at = [0, 0, 0], rot = 0, size, color = '#b8a48c' }: { name: string; at?: V3; rot?: number; size: V3; color?: string }) {
  const box = (
    <mesh position={[0, size[1] / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
  return (
    <group position={at} rotation-y={rot}>
      <OrBox box={box}><Suspense fallback={null}><Loaded name={name} /></Suspense></OrBox>
    </group>
  );
}

const DESK_H = 0.76;

/** Desk, monitor, keyboard and chair. The sitter is on the -z side, facing the camera. */
export function DeskSet({ at, active }: { at: Vec2; active: boolean }) {
  return (
    <group position={[at.x, 0, at.z]}>
      <Model name="desk" rot={Math.PI} size={[DESK_SIZE.w, DESK_H, DESK_SIZE.d]} />
      <Model name="computerScreen" at={[0, DESK_H, 0.15]} rot={Math.PI} size={[0.7, 0.5, 0.06]} color="#333333" />
      <mesh position={[0, DESK_H + 0.3, 0.08]} rotation-y={Math.PI}>
        <planeGeometry args={[0.62, 0.36]} />
        <meshStandardMaterial color="#1b1f2a" emissive={active ? '#58a6ff' : '#000000'} emissiveIntensity={active ? 1.2 : 0} />
      </mesh>
      <Model name="computerKeyboard" at={[0, DESK_H, -0.2]} rot={Math.PI} size={[0.5, 0.04, 0.2]} color="#444444" />
      <Model name="chairDesk" at={[0, 0, -SEAT - 0.1]} size={[0.6, 0.85, 0.6]} color="#555555" />
    </group>
  );
}

function Floor({ r, color }: { r: Rect; color: string }) {
  const c = center(r);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[c.x, 0.005, c.z]} receiveShadow>
      <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

/** Everything that does not move: floors, walls and the shared rooms' furniture. */
export function Building({ teams }: { teams: TeamDef[] }) {
  const used = new Set(teams.map((t) => t.room));
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[FLOOR.x1 - FLOOR.x0 + 2, FLOOR.z1 - FLOOR.z0 + 2]} />
        <meshStandardMaterial color="#d8d2c4" />
      </mesh>
      {Array.from({ length: ROOMS }, (_, i) => <Floor key={i} r={teamRoom(i + 1)} color={used.has(i + 1) ? '#e9d9bd' : '#e4ddd0'} />)}
      <Floor r={LOBBY} color="#ece6da" />
      <Floor r={MEETING} color="#d9e1ea" />
      <Floor r={LOUNGE} color="#eadccd" />
      {WALLS.map(([x0, z0, x1, z1, h], i) => (
        <mesh key={i} position={[(x0 + x1) / 2, h / 2, (z0 + z1) / 2]} castShadow receiveShadow>
          <boxGeometry args={[Math.abs(x1 - x0) + WALL_T, h, Math.abs(z1 - z0) + WALL_T]} />
          <meshStandardMaterial color={h === TALL ? '#f3efe7' : '#cfc6b6'} />
        </mesh>
      ))}

      {PROPS.map((p, i) => <Model key={i} name={p.name} at={[p.x, p.y ?? 0, p.z]} rot={p.rot} size={p.size} color={p.color} />)}
    </group>
  );
}
