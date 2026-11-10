import * as THREE from 'three';
import { GEO, HALL, SOLAR_DATE } from '../data/config';
import type { Engine } from '../core/engine';
import type { buildExterior } from './exterior';
import { WINDOW, WINDOWS } from './room';

const RAD = Math.PI / 180;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function dayOfYear(): number {
  const now = new Date();
  const [m, d] = SOLAR_DATE === 'today' ? [now.getMonth() + 1, now.getDate()] : SOLAR_DATE.split('-').map(Number);
  return Math.round((Date.UTC(2025, m - 1, d) - Date.UTC(2025, 0, 0)) / 864e5);
}

/** Real solar position (elevation / azimuth from north, clockwise) for the configured location. */
export function solarPosition(hours: number, day = dayOfYear()) {
  const decl = 23.44 * RAD * Math.sin((2 * Math.PI * (284 + day)) / 365);
  const solarTime = hours + (GEO.lon - 15 * GEO.utcOffset) / 15;
  const H = 15 * RAD * (solarTime - 12);
  const lat = GEO.lat * RAD;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H));
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  return { elevation, azimuth };
}

const SHEETS = 5; // light-shaft sheets per window
const C = {
  sunLow: new THREE.Color('#ffa765'), sunHigh: new THREE.Color('#fff1dc'), moon: new THREE.Color('#a9bcff'),
  skyNight: new THREE.Color('#141c33'), skyDay: new THREE.Color('#bcd3ff'), skyGold: new THREE.Color('#ffb98a'),
  fogNight: new THREE.Color('#080b14'), fogDay: new THREE.Color('#b4c8dc'), fogGold: new THREE.Color('#d98f5e'),
  lamp: new THREE.Color('#ffb76a'),
};

/** Drives sun, moon, sky, exterior lights, interior light shafts and exposure from the time of day. */
export class DayNight {
  /** Time currently shown (smoothed), in hours 0..24. */
  hours = 16.4;
  auto = false;
  /** Hours of day per real second in auto mode. */
  autoSpeed = 0.05;
  readonly sunDir = new THREE.Vector3();
  elevationDeg = 0;
  private target = 16.4;
  private applied = -1;
  private sun = new THREE.DirectionalLight('#ffffff', 0);
  private hemi = new THREE.HemisphereLight('#bcd3ff', '#3a2f26', 0.2);
  private shafts: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private day = dayOfYear();
  /** Extra exposure/ambient compensation, e.g. when the hall lights are off. */
  interiorLevel = 1;

  constructor(private engine: Engine, private ext: ReturnType<typeof buildExterior>) {
    const { scene } = engine;
    scene.fog = new THREE.FogExp2('#b4c8dc', 0.0018);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -22; cam.right = 22; cam.top = 22; cam.bottom = -22; cam.near = 1; cam.far = 130;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);
    engine.onQuality((_q, p) => {
      this.sun.castShadow = p.shadows > 0;
      if (p.shadows) {
        this.sun.shadow.mapSize.setScalar(p.shadows);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    });

    const n = WINDOWS.length * SHEETS * 6;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    this.shafts = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 color; uniform float opacity; varying vec2 vUv;
        void main(){
          float a = opacity * pow(1.0 - vUv.y, 1.4) * smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
          gl_FragColor = vec4(color * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 4;
    scene.add(this.shafts);
    this.apply();
  }

  setTime(hours: number, instant = false) {
    this.target = ((hours % 24) + 24) % 24;
    if (instant) this.hours = this.target;
  }
  get targetHours() {
    return this.target;
  }
  get isNight() {
    return this.elevationDeg < -4;
  }

  update(dt: number) {
    if (this.auto) this.target = (this.target + dt * this.autoSpeed) % 24;
    // Shortest way around the clock, critically damped.
    const diff = ((this.target - this.hours + 36) % 24) - 12;
    this.hours = (this.hours + diff * Math.min(1, dt * 6) + 24) % 24;
    if (Math.abs(this.hours - this.applied) > 1e-4 || this.interiorLevel !== this.appliedLevel) this.apply();
  }
  private appliedLevel = -1;

  private apply() {
    this.applied = this.hours;
    this.appliedLevel = this.interiorLevel;
    const { elevation, azimuth } = solarPosition(this.hours, this.day);
    const e = (this.elevationDeg = elevation / RAD);
    // East is -x, north is +z.
    this.sunDir.set(-Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));

    const dayF = smooth(-6, 8, e);
    const nightF = 1 - smooth(-12, -2, e);
    const goldF = Math.exp(-(((e - 2) / 8) ** 2));
    const sunF = smooth(-1, 12, e);

    // One shadow-casting light: the sun by day, the moon by night.
    const useSun = e > -3;
    const dir = useSun ? this.sunDir : this.sunDir.clone().negate().setY(Math.max(0.35, -this.sunDir.y)).normalize();
    this.sun.position.copy(dir).multiplyScalar(60);
    this.sun.color.copy(useSun ? C.sunLow.clone().lerp(C.sunHigh, smooth(2, 28, e)) : C.moon);
    this.sun.intensity = useSun ? 5.2 * sunF : 0.9 * nightF;

    this.hemi.color.copy(C.skyNight).lerp(C.skyDay, dayF).lerp(C.skyGold, goldF * 0.45);
    this.hemi.intensity = 0.2 + 0.95 * dayF;
    const { scene, renderer } = this.engine;
    scene.environmentIntensity = 0.1 + 0.4 * dayF + 0.3 * this.interiorLevel;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(1.08, 0.74, dayF) + (1 - this.interiorLevel) * 0.25 * (1 - dayF);
    (scene.fog as THREE.FogExp2).color.copy(C.fogNight).lerp(C.fogDay, dayF).lerp(C.fogGold, goldF * 0.6 * dayF);

    const u = this.ext.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 2 + 7 * goldF;
    u.rayleigh.value = 1 + 2.4 * goldF;
    u.mieCoefficient.value = 0.004 + 0.004 * goldF;
    u.mieDirectionalG.value = 0.82;

    const lampF = 1 - smooth(-4, 3, e);
    this.ext.starMat.opacity = nightF;
    this.ext.moon.position.copy(dir).multiplyScalar(430);
    this.ext.moon.visible = !useSun;
    this.ext.moonMat.opacity = nightF;
    this.ext.lampMat.color.copy(C.lamp).multiplyScalar(lampF * 4);
    this.ext.lampPoolMat.opacity = lampF * 0.28;
    this.ext.cityMat.emissiveIntensity = lampF * 1.6;

    this.updateShafts(useSun ? sunF * (0.35 + 0.65 * goldF) : nightF * 0.35);
    renderer.shadowMap.needsUpdate = true;
  }

  /** Fake volumetric light: translucent sheets from each sun-facing window down to the floor. */
  private updateShafts(strength: number) {
    const mat = this.shafts.material;
    mat.uniforms.opacity.value = strength * 0.055;
    mat.uniforms.color.value.copy(this.sun.color);
    this.shafts.visible = strength > 0.01;
    if (!this.shafts.visible) return;
    const pos = this.shafts.geometry.attributes.position as THREE.BufferAttribute;
    const uv = this.shafts.geometry.attributes.uv as THREE.BufferAttribute;
    const L = this.sun.position.clone().normalize().negate(); // direction the light (sun or moon) travels
    const maxLen = Math.hypot(HALL.w, HALL.d) * 0.6;
    let v = 0;
    const put = (x: number, y: number, z: number, s: number, t: number) => {
      pos.setXYZ(v, x, y, z);
      uv.setXY(v++, s, t);
    };
    for (const w of WINDOWS) {
      const facing = L.x * w.nx + L.z * w.nz;
      for (let k = 0; k < SHEETS; k++) {
        if (facing < 0.08) {
          for (let i = 0; i < 6; i++) put(0, -10, 0, 0, 1);
          continue;
        }
        const off = ((k + 0.5) / SHEETS - 0.5) * w.width * 0.92;
        const bx = w.x - w.nz * off + w.nx * 0.16, bz = w.z + w.nx * off + w.nz * 0.16;
        const tTop = Math.min(WINDOW.y1 / -L.y, maxLen), tBot = Math.min(WINDOW.y0 / -L.y, maxLen);
        const top: [number, number, number] = [bx, WINDOW.y1, bz];
        const bot: [number, number, number] = [bx, WINDOW.y0, bz];
        const topEnd: [number, number, number] = [bx + L.x * tTop, WINDOW.y1 + L.y * tTop, bz + L.z * tTop];
        const botEnd: [number, number, number] = [bx + L.x * tBot, WINDOW.y0 + L.y * tBot, bz + L.z * tBot];
        put(...top, 0, 0); put(...bot, 1, 0); put(...botEnd, 1, 1);
        put(...top, 0, 0); put(...botEnd, 1, 1); put(...topEnd, 0, 1);
      }
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
  }
}
