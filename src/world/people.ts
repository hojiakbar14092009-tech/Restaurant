import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Agent } from '../sim/agents';
import { cyl, merge, mesh, tint } from './build';
import { M } from './materials';

const BASE = `${import.meta.env.BASE_URL}assets/models/`;
type Palette = Record<string, string>;

const SKIN = ['#e8b796', '#c98d6a', '#f1c7a8', '#a86f4c', '#dba785'];
const HAIR = ['#2a1b12', '#111111', '#6b4423', '#b98a4a', '#3d2b1f', '#8c8c8c'];
const TOPS = ['#7c2d2d', '#2f4a5c', '#e7dfd0', '#3d5a45', '#b8925a', '#23262b', '#8a5a7a', '#c96f4a', '#4b5d8a'];
const BOTTOMS = ['#1f2530', '#3a3028', '#2b3a4a', '#4a4a4a', '#151515'];

interface ModelDef {
  file: string;
  height: number;
  palette: (pick: <T>(list: T[]) => T) => Palette;
}
const CUSTOMERS: ModelDef[] = [
  { file: 'man.glb', height: 1.76, palette: (p) => ({ Shirt: p(TOPS), Pants: p(BOTTOMS), Skin: p(SKIN), Hair: p(HAIR), Socks: '#22201e', Eyes: '#161616' }) },
  { file: 'woman-casual.glb', height: 1.66, palette: (p) => ({ Shirt: p(TOPS), Pants: p(BOTTOMS), Skin: p(SKIN), Hair: p(HAIR), HairBase: '#1a1210', Shoes: '#1c1a19', Socks: '#e9e2d6', Eyes: '#161616' }) },
  { file: 'woman-dress.glb', height: 1.66, palette: (p) => ({ Dress: p(TOPS), Skin: p(SKIN), Hair: p(HAIR), Shoes: '#1c1a19', Eyes: '#161616' }) },
];
/** Waiter uniform: black vest and trousers, white shirt, brass tie and a long ivory apron. */
const WAITER: ModelDef = {
  file: 'waiter.glb',
  height: 1.78,
  palette: (p) => ({ Shirt: '#141414', Pants: '#101010', Details: '#f4f0e8', TieTexture: '#b8925a', Skin: p(SKIN), Hair: p(HAIR), Eyes: '#161616' }),
};
const VARIANTS = 4; // colour variants per customer model

interface Template {
  scene: THREE.Object3D;
  clips: Record<'idle' | 'walk' | 'sit', THREE.AnimationClip>;
}
interface Person {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Partial<Record<'idle' | 'walk' | 'sit', THREE.AnimationAction>>;
  current: string;
  tray: THREE.Object3D | null;
  model: THREE.Object3D | null;
  x: number;
  z: number;
  speed: number;
}

const bodyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

/**
 * Collapses the character's per-material primitives into one skinned mesh with vertex colours:
 * one draw call per person instead of 5-8. `apron` repaints the trousers between knee and waist.
 */
function bake(scene: THREE.Object3D, def: ModelDef, palette: Palette, apron: boolean): THREE.Object3D {
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
  if (!meshes.length) return scene;
  const first = meshes[0];
  let zMax = 0;
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    zMax = Math.max(zMax, m.geometry.boundingBox!.max.z);
  }
  const parts = meshes.map((m) => {
    const name = (m.material as THREE.Material).name;
    const g = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(key, m.geometry.attributes[key]);
    g.setIndex(m.geometry.index);
    const pos = g.attributes.position;
    const base = new THREE.Color(palette[name] ?? (m.material as THREE.MeshStandardMaterial).color);
    const ivory = new THREE.Color('#ece5d6');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getZ(i) / zMax; // the rig is Z-up in bind pose
      (apron && name === 'Pants' && h > 0.3 && h < 0.6 ? ivory : base).toArray(colors, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const body = new THREE.SkinnedMesh(mergeGeometries(parts, false), bodyMaterial);
  body.bind(first.skeleton, first.bindMatrix);
  body.castShadow = true;
  body.frustumCulled = false; // skinned bounds are unreliable; people are always near the camera anyway
  first.parent!.add(body);
  for (const m of meshes) m.removeFromParent();

  // Normalise the height using the head bone.
  scene.updateMatrixWorld(true);
  const head = scene.getObjectByName('Head_end') ?? scene.getObjectByName('Head');
  const top = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.7;
  scene.scale.multiplyScalar(def.height / Math.max(0.01, top));
  return scene;
}

function fallbackFigure(color: string) {
  const g = merge([
    [tint(cyl(0.17, 0.2, 0.75, 12), color), new THREE.Matrix4().makeTranslation(0, 1.05, 0)],
    [tint(cyl(0.16, 0.14, 0.7, 12), '#1f2530'), new THREE.Matrix4().makeTranslation(0, 0.35, 0)],
    [tint(new THREE.SphereGeometry(0.12, 14, 10), '#e0b08c'), new THREE.Matrix4().makeTranslation(0, 1.56, 0)],
  ]);
  return mesh(g, M.painted, { receive: false });
}

const trayGeo = merge([
  [tint(cyl(0.2, 0.2, 0.012, 24), '#b8925a')],
  [tint(cyl(0.06, 0.05, 0.1, 12), '#efe6d8'), new THREE.Matrix4().makeTranslation(0.05, 0.055, 0)],
  [tint(cyl(0.05, 0.05, 0.03, 12), '#c98a45'), new THREE.Matrix4().makeTranslation(-0.08, 0.02, 0.04)],
]);

/** Draws every simulation agent as an animated character. */
export class People {
  readonly group = new THREE.Group();
  private templates: { customers: Template[][]; waiter: Template[] } | null = null;
  private people = new Map<number, Person>();
  /** Agent whose body is hidden because the camera sits in their head. */
  hiddenSeat: { tableId: number; index: number } | null = null;

  async load(onProgress?: (fraction: number) => void) {
    const loader = new GLTFLoader();
    const defs = [...CUSTOMERS, WAITER];
    let done = 0;
    try {
      const gltfs = await Promise.all(defs.map((d) => loader.loadAsync(BASE + d.file).then((g) => (onProgress?.(++done / defs.length), g))));
      let seed = 1;
      const pick = <T>(list: T[]) => list[(seed = (seed * 1103515245 + 12345) & 0x7fffffff) % list.length];
      const make = (i: number, apron: boolean): Template => {
        const gltf = gltfs[i];
        const find = (re: RegExp) => gltf.animations.find((a) => re.test(a.name))!;
        return {
          scene: bake(cloneSkinned(gltf.scene), defs[i], defs[i].palette(pick), apron),
          clips: { idle: find(/Idle/), walk: find(/Walk/), sit: find(/Sitting/) },
        };
      };
      this.templates = {
        customers: CUSTOMERS.map((_, i) => Array.from({ length: VARIANTS }, () => make(i, false))),
        waiter: Array.from({ length: VARIANTS }, () => make(CUSTOMERS.length, true)),
      };
    } catch (err) {
      console.warn('Character models failed to load; using simple figures instead.', err);
    }
  }

  private create(a: Agent): Person {
    let root: THREE.Object3D;
    let model: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const actions: Person['actions'] = {};
    if (this.templates) {
      const t = a.kind === 'waiter'
        ? this.templates.waiter[a.variant % VARIANTS]
        : this.templates.customers[a.variant % CUSTOMERS.length][Math.floor(a.variant / CUSTOMERS.length) % VARIANTS];
      model = cloneSkinned(t.scene);
      root = new THREE.Group().add(model);
      mixer = new THREE.AnimationMixer(model);
      actions.idle = mixer.clipAction(t.clips.idle);
      actions.walk = mixer.clipAction(t.clips.walk);
      // The clip is "sit down, then stay seated": play it once and hold the last pose (looping it stands up again).
      actions.sit = mixer.clipAction(t.clips.sit).setLoop(THREE.LoopOnce, 1);
      actions.sit.clampWhenFinished = true;
      mixer.setTime(Math.random() * 4); // de-synchronise idle loops
    } else {
      root = fallbackFigure(a.kind === 'waiter' ? '#141414' : TOPS[a.variant % TOPS.length]);
    }
    let tray: THREE.Object3D | null = null;
    if (a.kind === 'waiter') {
      tray = mesh(trayGeo, M.painted, { receive: false });
      tray.position.set(0.24, 1.18, 0.26);
      tray.visible = false;
      root.add(tray);
    }
    root.position.set(a.x, 0, a.z);
    root.rotation.y = a.yaw;
    this.group.add(root);
    return { root, mixer, actions, current: '', tray, model, x: a.x, z: a.z, speed: 0 };
  }

  /** dt = real frame time; rate = how much faster than real time the people move (simulation speed). */
  update(agents: Map<number, Agent>, dt: number, rate: number) {
    for (const [id, p] of this.people)
      if (!agents.has(id)) {
        this.group.remove(p.root);
        p.mixer?.stopAllAction();
        this.people.delete(id);
      }
    for (const a of agents.values()) {
      let p = this.people.get(a.id);
      if (!p) this.people.set(a.id, (p = this.create(a)));
      p.root.position.set(a.x, 0, a.z);
      // Turn smoothly towards the heading.
      const d = Math.atan2(Math.sin(a.yaw - p.root.rotation.y), Math.cos(a.yaw - p.root.rotation.y));
      p.root.rotation.y += d * Math.min(1, dt * 9 * Math.min(rate, 4));
      p.root.visible = !(this.hiddenSeat && a.seat && a.sitting && a.seat.tableId === this.hiddenSeat.tableId && a.seat.index === this.hiddenSeat.index);
      if (p.tray) p.tray.visible = a.carrying;

      // Animation follows the distance actually covered, so nobody walks on the spot or slides.
      const v = Math.hypot(a.x - p.x, a.z - p.z) / Math.max(dt * rate, 1e-4);
      p.speed += (v - p.speed) * Math.min(1, dt * 12);
      p.x = a.x;
      p.z = a.z;
      const want = a.sitting ? 'sit' : p.speed > 0.25 ? 'walk' : 'idle';
      // The seated pose drops the hips ~0.3 m behind the root: shift the body forward onto the cushion.
      if (p.model) p.model.position.z += ((a.sitting ? 0.27 : 0) - p.model.position.z) * Math.min(1, dt * 6);
      if (p.actions.walk) p.actions.walk.timeScale = THREE.MathUtils.clamp(p.speed / 1.25, 0.5, 1.6);
      if (want !== p.current) {
        const next = p.actions[want];
        const prev = p.actions[p.current as keyof Person['actions']];
        if (next) {
          next.reset().fadeIn(0.25).play();
          prev?.fadeOut(0.25);
        }
        p.current = want;
      }
      // Seated guests hold a still pose once they have sat down: no need to animate them every frame.
      const settled = p.current === 'sit' && p.actions.sit!.paused;
      if (!settled) p.mixer?.update(dt * Math.min(rate, 3)); // capped so animations stay readable at 12x
    }
  }
}
