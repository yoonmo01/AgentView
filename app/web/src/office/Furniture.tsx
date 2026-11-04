import { useGLTF } from '@react-three/drei';
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { Box3, Color, Vector3, type Mesh } from 'three';
import { center, DESK_CHAIR, DESK_SIZE, LEAD_CHAIR, LEAD_SCALE, TALL, WALL_T, type Desk, type Floor, type Rect } from './layout.ts';

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

/** Desk, monitor, keyboard and chair. The sitter is on the -z side facing the camera, or turned around when flipped; the lead desk is bigger with a gold chair. */
export function DeskSet({ desk, active }: { desk: Desk; active: boolean }) {
  const k = desk.lead ? LEAD_SCALE : 1;
  return (
    <group position={[desk.x, 0, desk.z]} rotation-y={desk.flip ? Math.PI : 0}>
      <Model name="desk" rot={Math.PI} size={[DESK_SIZE.w * k, DESK_H, DESK_SIZE.d * k]} />
      <Model name="computerScreen" at={[0, DESK_H, 0.15]} rot={Math.PI} size={[0.7, 0.5, 0.06]} color="#333333" />
      <mesh position={[0, DESK_H + 0.3, 0.08]} rotation-y={Math.PI}>
        <planeGeometry args={[0.62, 0.36]} />
        <meshStandardMaterial color="#1b1f2a" emissive={active ? '#58a6ff' : '#000000'} emissiveIntensity={active ? 1.2 : 0} />
      </mesh>
      <Model name="computerKeyboard" at={[0, DESK_H, -0.2]} rot={Math.PI} size={[0.5, 0.04, 0.2]} color="#444444" />
      <Model name="chairDesk" at={[0, 0, DESK_CHAIR.z]} size={[DESK_CHAIR.size, 0.85, DESK_CHAIR.size]} color={desk.lead ? LEAD_CHAIR : '#555555'} />
    </group>
  );
}

function Patch({ r, color }: { r: Rect; color: string }) {
  const c = center(r);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[c.x, 0.005, c.z]} receiveShadow>
      <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

/** Everything that does not move: floors (team rooms tinted with the team color), walls and furniture. */
export function Building({ floor }: { floor: Floor }) {
  const b = floor.bounds;
  const tint = (c: string) => `#${new Color('#ece4d4').lerp(new Color(c || '#c9a96e'), 0.22).getHexString()}`;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[(b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2]} receiveShadow>
        <planeGeometry args={[b.x1 - b.x0 + 2, b.z1 - b.z0 + 2]} />
        <meshStandardMaterial color="#d8d2c4" />
      </mesh>
      {floor.rooms.map((r) => <Patch key={r.team.id} r={r.rect} color={tint(r.team.color)} />)}
      <Patch r={floor.lobby} color="#ece6da" />
      <Patch r={floor.meeting} color="#d9e1ea" />
      <Patch r={floor.lounge} color="#eadccd" />
      {floor.walls.map(([x0, z0, x1, z1, h], i) => (
        <mesh key={i} position={[(x0 + x1) / 2, h / 2, (z0 + z1) / 2]} castShadow receiveShadow>
          <boxGeometry args={[Math.abs(x1 - x0) + WALL_T, h, Math.abs(z1 - z0) + WALL_T]} />
          <meshStandardMaterial color={h === TALL ? '#f3efe7' : '#cfc6b6'} />
        </mesh>
      ))}
      {[...floor.props, ...floor.rooms.flatMap((r) => r.props)].map((p, i) => (
        <Model key={i} name={p.name} at={[p.x, p.y ?? 0, p.z]} rot={p.rot} size={p.size} color={p.color} />
      ))}
    </group>
  );
}
