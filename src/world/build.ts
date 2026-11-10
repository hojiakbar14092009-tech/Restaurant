import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Transform matrix from position, Euler rotation and scale. */
export function mat(x = 0, y = 0, z = 0, ry = 0, s: number | [number, number, number] = 1, rx = 0, rz = 0) {
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), sc);
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rTop: number, rBottom: number, h: number, seg = 20) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
/** Lathe profile from [radius, height] pairs. */
export const lathe = (profile: [number, number][], seg = 20) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);

/** Paints a geometry with one vertex colour (used to merge multi-colour objects into one draw call). */
export function tint<T extends THREE.BufferGeometry>(geo: T, color: THREE.ColorRepresentation): T {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Merges transformed parts into a single geometry. */
export function merge(parts: [THREE.BufferGeometry, THREE.Matrix4?][]): THREE.BufferGeometry {
  const geos = parts.map(([g, m]) => {
    const c = g.index ? g.toNonIndexed() : g.clone();
    if (m) c.applyMatrix4(m);
    return c;
  });
  const out = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return out;
}

export interface MeshOpts {
  cast?: boolean;
  receive?: boolean;
}
export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, { cast = true, receive = true }: MeshOpts = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** One draw call for many copies of the same geometry. */
export function instanced(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
  { cast = true, receive = true }: MeshOpts = {},
  colors?: THREE.ColorRepresentation[],
) {
  const m = new THREE.InstancedMesh(geo, material, matrices.length);
  const c = new THREE.Color();
  matrices.forEach((mx, i) => {
    m.setMatrixAt(i, mx);
    if (colors) m.setColorAt(i, c.set(colors[i % colors.length]));
  });
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.instanceMatrix.needsUpdate = true;
  return m;
}

/** Canvas-backed texture helper. */
export function canvasTexture(size: number | [number, number], draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const [w, h] = typeof size === 'number' ? [size, size] : size;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Small deterministic PRNG so the procedural scene looks the same on every load. */
export function seeded(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
