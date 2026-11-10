import * as THREE from 'three';
import gsap from 'gsap';
import { HALL } from '../data/config';
import { reducedMotion } from '../core/engine';
import { box, cyl, instanced, mat, merge } from './build';
import { M } from './materials';

/** Three grand crystal chandeliers on long chains. */
const CHANDELIERS: [number, number][] = [[-7.6, -2.6], [0, -2.6], [7.6, -2.6]];
const RING_Y = 4.9;
const WARM = new THREE.Color('#ffd2a0');
const EMBER = new THREE.Color('#ff5a1c');
const OFF = new THREE.Color('#2a2622'); // unlit frosted glass
const MAX_INTENSITY = 60;
/** Shared candle fill lights (no shadows): one per cluster of tables instead of one per candle. */
const CANDLE_LIGHTS: [number, number][] = [[-5.4, -1.6], [5.6, -0.8]];

/**
 * Chandeliers, sconces, the bar light and the candle fill lights.
 * Every light stays in the scene for good and only its intensity / colour is animated:
 * adding, removing or hiding a light would force three.js to recompile every shader (a visible freeze).
 */
export class HallLights {
  readonly group = new THREE.Group();
  on = true;
  private levels = CHANDELIERS.map(() => ({ v: 1 }));
  private lights: THREE.PointLight[] = [];
  private candleLights: THREE.PointLight[] = [];
  private globes: THREE.InstancedMesh;
  private sconceMat = new THREE.MeshBasicMaterial();
  private fill = new THREE.AmbientLight('#ffdcb8', 0);
  private tmp = new THREE.Color();

  constructor(private candle: { flameMat: THREE.ShaderMaterial; poolMat: THREE.MeshBasicMaterial }) {
    // Two tiers of brass rings, a chain, a ceiling rose and arms for the lamps.
    const tiers: [number, number, number][] = [[1.15, RING_Y, 8], [0.7, RING_Y + 0.55, 4]];
    const parts: [THREE.BufferGeometry, THREE.Matrix4][] = [
      [cyl(0.02, 0.02, HALL.h - RING_Y - 0.5, 6), mat(0, (HALL.h + RING_Y + 0.5) / 2, 0)],
      [cyl(0.45, 0.5, 0.06, 28), mat(0, HALL.h - 0.45, 0)],
      [cyl(0.05, 0.12, 0.5, 12), mat(0, RING_Y + 0.8, 0)],
    ];
    for (const [r, y] of tiers) {
      parts.push([new THREE.TorusGeometry(r, 0.022, 8, 56).rotateX(Math.PI / 2), mat(0, y, 0)]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push([box(r, 0.014, 0.014), mat((Math.cos(a) * r) / 2, y + 0.12, (Math.sin(a) * r) / 2, -a, 1, 0, 0.24)]);
      }
    }
    this.group.add(instanced(merge(parts), M.brass, CHANDELIERS.map(([x, z]) => mat(x, 0, z)), { cast: false }));
    const crystals: THREE.Matrix4[] = [], globeMx: THREE.Matrix4[] = [];
    for (const [x, z] of CHANDELIERS) {
      for (const [r, y, lamps] of tiers) {
        for (let i = 0; i < lamps; i++) {
          const a = (i / lamps) * Math.PI * 2 + r;
          globeMx.push(mat(x + Math.cos(a) * r, y + 0.09, z + Math.sin(a) * r));
        }
        // Crystal drops hanging under each ring.
        const drops = Math.round(r * 30);
        for (let i = 0; i < drops; i++) {
          const a = (i / drops) * Math.PI * 2;
          crystals.push(mat(x + Math.cos(a) * r, y - 0.1 - (i % 3) * 0.07, z + Math.sin(a) * r, a, [0.6, 1.5 + (i % 2), 0.6]));
        }
      }
      for (let i = 0; i < 7; i++) crystals.push(mat(x, RING_Y - 0.25 - i * 0.07, z, i, [1.4 - i * 0.14, 1.2, 1.4 - i * 0.14]));
    }
    this.group.add(instanced(new THREE.OctahedronGeometry(0.035, 0), M.crystal, crystals, { cast: false, receive: false }));
    this.globes = instanced(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial(), globeMx, { cast: false, receive: false }, ['#ffffff']);
    this.group.add(this.globes);

    for (const [x, z] of CHANDELIERS) {
      const l = new THREE.PointLight(WARM, MAX_INTENSITY, 30, 1.7);
      l.position.set(x, RING_Y - 0.4, z);
      this.lights.push(l);
      this.group.add(l);
    }
    for (const [x, z] of CANDLE_LIGHTS) {
      const l = new THREE.PointLight('#ff9d4d', 2.2, 15, 1.4);
      l.position.set(x, 1.25, z);
      this.candleLights.push(l);
      this.group.add(l);
    }

    // Wall sconces on the pilasters and the north wall (glow only, no real light).
    const brackets: THREE.Matrix4[] = [], shades: THREE.Matrix4[] = [];
    const sconce = (x: number, z: number, ry: number) => {
      brackets.push(mat(x, 2.5, z, ry));
      shades.push(mat(x + Math.sin(ry) * 0.09, 2.58, z + Math.cos(ry) * 0.09));
    };
    for (let x = -HALL.w / 2 + 4.5; x < HALL.w / 2 - 1; x += 4.5) sconce(x, -HALL.d / 2 + 0.18, 0);
    for (let z = -HALL.d / 2 + 4.5; z < HALL.d / 2 - 1; z += 4.5) (sconce(-HALL.w / 2 + 0.18, z, Math.PI / 2), sconce(HALL.w / 2 - 0.18, z, -Math.PI / 2));
    for (const x of [-12.2, -7.6, -6.4, -4.3, -2.2, -0.2, 1.9, 11.4]) sconce(x, HALL.d / 2 - 0.06, Math.PI);
    const bracket = merge([[box(0.09, 0.26, 0.02), mat(0, 0, 0)], [cyl(0.008, 0.008, 0.09, 6).rotateX(Math.PI / 2), mat(0, 0.04, 0.045)]]);
    this.group.add(instanced(bracket, M.brass, brackets, { cast: false }));
    this.group.add(instanced(cyl(0.05, 0.07, 0.19, 14), this.sconceMat, shades, { cast: false, receive: false }));

    // The bar is lit by its emissive back panel only: every extra point light is paid for on every pixel.
    this.group.add(this.fill);
    this.update(0);
  }

  /** 0..1 average brightness of the hall lights. */
  get level() {
    let s = 0;
    for (const l of this.levels) s += l.v;
    return s / this.levels.length;
  }

  set(on: boolean) {
    this.on = on;
    this.levels.forEach((l, i) => {
      gsap.killTweensOf(l);
      if (reducedMotion()) return void (l.v = on ? 1 : 0);
      if (on) {
        gsap.to(l, { v: 1, duration: 1.1, delay: i * 0.3, ease: 'power2.out' });
      } else {
        // Filament cooling: a sharp drop, two weak flickers, then a slow fade to dark.
        gsap.timeline({ delay: i * 0.1 })
          .to(l, { v: 0.22, duration: 0.1, ease: 'power2.in' })
          .to(l, { v: 0.4, duration: 0.07 })
          .to(l, { v: 0.1, duration: 0.12 })
          .to(l, { v: 0.2, duration: 0.06 })
          .to(l, { v: 0, duration: 1.2, ease: 'power1.out' });
      }
    });
  }

  update(t: number) {
    const per = this.globes.count / this.levels.length;
    for (let i = 0; i < this.levels.length; i++) {
      const v = this.levels[i].v;
      this.lights[i].intensity = MAX_INTENSITY * v * v;
      this.tmp.copy(EMBER).lerp(WARM, Math.min(1, v * 1.4));
      this.lights[i].color.copy(this.tmp);
      // Lit lamps glow (HDR, so they bloom); unlit ones are plain dark glass, not red embers.
      this.tmp.multiplyScalar(v * 3.2).lerp(OFF, 1 - Math.min(1, v * 6));
      for (let k = 0; k < per; k++) this.globes.setColorAt(i * per + k, this.tmp);
    }
    this.globes.instanceColor!.needsUpdate = true;
    const lv = this.level;
    this.sconceMat.color.copy(EMBER).lerp(WARM, Math.min(1, lv * 1.4)).multiplyScalar(lv * 2.2).lerp(OFF, 1 - Math.min(1, lv * 6));
    this.fill.intensity = 0.22 * lv;
    // Candles: flame shader time, the pool on each cloth and the shared fill lights flicker together.
    this.candle.flameMat.uniforms.time.value = t;
    const flicker = 0.92 + 0.08 * Math.sin(t * 11) * Math.sin(t * 7.3);
    this.candle.poolMat.opacity = (0.07 + 0.55 * (1 - lv)) * flicker;
    for (let i = 0; i < this.candleLights.length; i++)
      this.candleLights[i].intensity = (2 + 7 * (1 - lv)) * (0.9 + 0.1 * Math.sin(t * 9 + i * 2.1) * Math.sin(t * 5.7 + i));
  }
}
