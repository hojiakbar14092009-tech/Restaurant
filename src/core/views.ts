import * as THREE from 'three';
import gsap from 'gsap';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BAR, HALL, HOST_STAND, PLANTS, POINTS, SEAT_RADIUS, TABLES, seatsOf, type Pt, type SeatDef } from '../data/config';
import { reducedMotion, type Engine } from './engine';

const EYE = 1.15; // seated eye height (m)
const OVERVIEW = { pos: new THREE.Vector3(11.8, 5.4, 7.6), target: new THREE.Vector3(-1.5, 1.0, -2.2), fov: 58 };
const SEAT_FOV = 66;
const ALL_SEATS = TABLES.flatMap(seatsOf);
const W = HALL.w / 2, D = HALL.d / 2;

// ----- walk mode tuning
const STAND = 1.65, CROUCH = 1.05, BODY = 0.3;
const SPEED = { walk: 1.9, sprint: 3.8, crouch: 1.0 };
const GRAVITY = 13, JUMP = 4.4, STRIDE = 0.78;
/** Static colliders as circles (x, z, radius): a table with its chairs, plants, the host stand. */
const CIRCLES: [number, number, number][] = [
  ...TABLES.map((t) => [t.x, t.z, SEAT_RADIUS + 0.32] as [number, number, number]),
  ...PLANTS.map((p) => [p.x, p.z, 0.45] as [number, number, number]),
  [HOST_STAND.x, HOST_STAND.z, 0.5],
];
const BAR_RECT = { x0: BAR.x0 - 0.2, x1: BAR.x1 + 0.2, z0: BAR.stoolZ - 0.3, z1: D };
const onRug = (x: number, z: number) => Math.abs(x - POINTS.door.x) < 1 && z > D - 4.4;

export type ViewMode = 'overview' | 'seat' | 'walk';

/** Camera modes: free orbit inside the hall, a first-person view from any seat, and walking on foot. */
export class Views {
  mode: ViewMode = 'overview';
  seat: SeatDef | null = null;
  /** True while the pointer moved enough to count as a drag rather than a click. */
  dragged = false;
  dofEnabled = false;
  /** Walk-mode hooks: other people to bump into, and footstep / landing sounds. */
  people: () => Iterable<Pt> = () => [];
  onStep: (sprint: boolean, rug: boolean) => void = () => {};
  onLand: () => void = () => {};
  /** Analogue move input from the touch joystick (-1..1). */
  stick = { x: 0, y: 0 };
  /** Feet position of the walker. */
  readonly feet = { x: POINTS.door.x, z: POINTS.door.z - 1.6 };
  private keys = new Set<string>();
  private vel = { x: 0, z: 0, y: 0 };
  private height = 0; // jump height above the floor
  private eye = STAND;
  private dip = 0; // landing dip
  private stride = 0;
  private controls: OrbitControls;
  private busy = false;
  private yaw = 0;
  private pitch = 0;
  private listeners: (() => void)[] = [];
  private saved = { pos: OVERVIEW.pos.clone(), quat: new THREE.Quaternion() };
  private flight: { t: number } = { t: 0 };
  private canvas: HTMLElement;

  constructor(private engine: Engine) {
    const { camera, renderer } = engine;
    this.canvas = renderer.domElement;
    camera.fov = OVERVIEW.fov;
    this.controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.07, enablePan: false, rotateSpeed: 0.55, zoomSpeed: 0.7,
      minDistance: 3, maxDistance: 19, minPolarAngle: 0.6, maxPolarAngle: 1.5,
    });
    this.controls.target.copy(OVERVIEW.target);
    camera.position.copy(OVERVIEW.pos);
    camera.lookAt(OVERVIEW.target);
    this.saved.quat.copy(camera.quaternion);
    this.bindLook(renderer.domElement);
    addEventListener('keydown', (e) => this.mode === 'walk' && !e.repeat && this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => this.keys.clear());
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private changed() {
    for (const fn of this.listeners) fn();
  }
  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  /** Slow cinematic move from the entrance to the overview corner. */
  intro() {
    const { camera } = this.engine;
    if (reducedMotion()) return;
    this.busy = true;
    this.controls.enabled = false;
    const from = new THREE.Vector3(POINTS.door.x + 0.4, 1.7, D - 2), look = new THREE.Vector3(-2, 2.2, -4), tmp = new THREE.Vector3();
    const p = { t: 0 };
    this.flight = p;
    gsap.to(p, {
      t: 1, duration: 5.5, ease: 'power2.inOut',
      onUpdate: () => {
        camera.position.lerpVectors(from, OVERVIEW.pos, p.t);
        camera.position.y += Math.sin(p.t * Math.PI) * 0.5;
        camera.lookAt(tmp.lerpVectors(look, OVERVIEW.target, p.t));
      },
      onComplete: () => {
        this.busy = false;
        this.controls.enabled = true;
      },
    });
  }

  private seatPose(seat: SeatDef) {
    const pos = new THREE.Vector3(seat.x + Math.sin(seat.yaw) * 0.06, EYE, seat.z + Math.cos(seat.yaw) * 0.06);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, seat.yaw + Math.PI, 0, 'YXZ'));
    return { pos, quat };
  }

  private fly(pos: THREE.Vector3, quat: THREE.Quaternion, fov: number, done: () => void) {
    const { camera } = this.engine;
    const p0 = camera.position.clone(), q0 = camera.quaternion.clone(), f0 = camera.fov;
    const dist = p0.distanceTo(pos);
    const p = { t: 0 };
    this.busy = true;
    this.controls.enabled = false;
    gsap.killTweensOf(this.flight);
    this.flight = p;
    gsap.to(p, {
      t: 1, duration: reducedMotion() ? 0.01 : THREE.MathUtils.clamp(0.7 + dist * 0.1, 0.9, 2.2), ease: 'power2.inOut',
      onUpdate: () => {
        camera.position.lerpVectors(p0, pos, p.t);
        camera.position.y += Math.sin(p.t * Math.PI) * Math.min(0.5, dist * 0.05);
        camera.quaternion.slerpQuaternions(q0, quat, p.t);
        camera.fov = THREE.MathUtils.lerp(f0, fov, p.t);
        camera.updateProjectionMatrix();
      },
      onComplete: () => {
        this.busy = false;
        done();
      },
    });
  }

  /** Remember the orbit pose when leaving the overview, so "exit" returns to it. */
  private leaveOverview() {
    if (this.mode !== 'overview' || this.busy) return;
    this.saved.pos.copy(this.engine.camera.position);
    this.saved.quat.copy(this.engine.camera.quaternion);
  }

  enterSeat(seat: SeatDef) {
    this.leaveOverview();
    if (this.locked) document.exitPointerLock();
    this.mode = 'seat';
    this.seat = seat;
    this.yaw = 0;
    this.pitch = -0.18;
    const { pos, quat } = this.seatPose(seat);
    this.changed();
    this.fly(pos, quat, SEAT_FOV, () => this.applyDof());
  }

  /** Step to the previous / next seat (wraps around all seats). */
  stepSeat(dir: 1 | -1) {
    if (!this.seat) return;
    const i = ALL_SEATS.findIndex((s) => s.tableId === this.seat!.tableId && s.index === this.seat!.index);
    this.enterSeat(ALL_SEATS[(i + dir + ALL_SEATS.length) % ALL_SEATS.length]);
  }

  /** Walk on foot. Must be called from a user gesture so the mouse can be captured. */
  enterWalk() {
    if (this.mode === 'walk') return void this.lock();
    this.leaveOverview();
    if (this.seat) {
      // Stand up next to the chair you were sitting on.
      this.feet.x = this.seat.approach.x;
      this.feet.z = this.seat.approach.z;
      this.yaw = this.seat.yaw;
    } else this.yaw = Math.PI;
    this.mode = 'walk';
    this.seat = null;
    this.pitch = 0;
    this.vel.x = this.vel.z = this.vel.y = this.height = 0;
    this.eye = STAND;
    this.engine.setDof(false);
    this.changed();
    this.lock();
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw + Math.PI, 0, 'YXZ'));
    this.fly(new THREE.Vector3(this.feet.x, STAND, this.feet.z), quat, 70, () => {});
  }
  private lock() {
    // Touch devices have no pointer lock: they look around by dragging instead.
    if (!matchMedia('(pointer: coarse)').matches) (this.canvas.requestPointerLock() as Promise<void> | undefined)?.catch?.(() => {});
  }

  /** Back to the overview from a seat or from walking. */
  exit() {
    if (this.mode === 'overview') return;
    if (this.locked) document.exitPointerLock();
    this.mode = 'overview';
    this.seat = null;
    this.keys.clear();
    this.engine.setDof(false);
    this.changed();
    this.fly(this.saved.pos, this.saved.quat, OVERVIEW.fov, () => {
      this.controls.enabled = true;
    });
  }

  setDof(on: boolean) {
    this.dofEnabled = on;
    this.applyDof();
  }
  private applyDof() {
    this.engine.setDof(this.dofEnabled && this.mode === 'seat', 1.0);
  }

  jump() {
    if (this.mode === 'walk' && this.height === 0) this.vel.y = JUMP;
  }
  private key(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement).closest?.('input, [role="slider"], dialog')) return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (down && e.code === 'Space') (e.preventDefault(), this.jump());
  }

  /** Mouse / touch look: clamped like a head turn when seated, free yaw when walking. */
  private bindLook(el: HTMLElement) {
    let down: { x: number; y: number } | null = null;
    let last = { x: 0, y: 0 };
    const turn = (dx: number, dy: number) => {
      if (this.busy || this.mode === 'overview') return;
      const k = 0.0042, walking = this.mode === 'walk';
      this.yaw -= dx * k;
      if (!walking) this.yaw = THREE.MathUtils.clamp(this.yaw, -2.0, 2.0);
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, walking ? -1.35 : -0.95, walking ? 1.35 : 0.6);
    };
    el.addEventListener('pointerdown', (e) => {
      down = last = { x: e.clientX, y: e.clientY };
      this.dragged = false;
    });
    addEventListener('pointermove', (e) => {
      if (this.locked) return void turn(e.movementX * 0.6, e.movementY * 0.6);
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) this.dragged = true;
      turn(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    });
    addEventListener('pointerup', () => (down = null));
    addEventListener('pointercancel', () => (down = null));
  }

  /** Keeps the walker out of furniture, walls and people: push out of each collider, which slides along it. */
  private collide() {
    const f = this.feet;
    const push = (cx: number, cz: number, r: number) => {
      const dx = f.x - cx, dz = f.z - cz, d = Math.hypot(dx, dz), min = r + BODY;
      if (d >= min || d < 1e-5) return;
      f.x = cx + (dx / d) * min;
      f.z = cz + (dz / d) * min;
    };
    for (const [x, z, r] of CIRCLES) push(x, z, r);
    for (const p of this.people()) push(p.x, p.z, 0.3);
    const b = BAR_RECT;
    if (f.x > b.x0 - BODY && f.x < b.x1 + BODY && f.z > b.z0 - BODY) {
      // Leave the bar through the nearest face.
      const left = f.x - (b.x0 - BODY), right = b.x1 + BODY - f.x, front = f.z - (b.z0 - BODY);
      if (front <= left && front <= right) f.z = b.z0 - BODY;
      else if (left < right) f.x = b.x0 - BODY;
      else f.x = b.x1 + BODY;
    }
    f.x = THREE.MathUtils.clamp(f.x, -W + 0.55, W - 0.55);
    f.z = THREE.MathUtils.clamp(f.z, -D + 0.55, D - 0.45);
  }

  private walk(dt: number) {
    const k = this.keys, f = this.feet, v = this.vel;
    const crouch = k.has('KeyC') || k.has('ControlLeft') || k.has('ControlRight');
    const sprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && !crouch;
    let mx = this.stick.x + (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let mz = this.stick.y + (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const len = Math.hypot(mx, mz);
    if (len > 1) (mx /= len), (mz /= len);
    const speed = crouch ? SPEED.crouch : sprint ? SPEED.sprint : SPEED.walk;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (sin, cos); right = (-cos, sin)
    const tx = (mz * sin - mx * cos) * speed, tz = (mz * cos + mx * sin) * speed;
    const a = Math.min(1, dt * (len ? 9 : 12)); // smooth acceleration, slightly quicker stop
    v.x += (tx - v.x) * a;
    v.z += (tz - v.z) * a;
    const px = f.x, pz = f.z;
    f.x += v.x * dt;
    f.z += v.z * dt;
    this.collide();
    const moved = Math.hypot(f.x - px, f.z - pz);

    // Jump with gravity and a soft landing.
    if (this.height > 0 || v.y > 0) {
      v.y -= GRAVITY * dt;
      this.height += v.y * dt;
      if (this.height <= 0) {
        if (v.y < -2) (this.dip = Math.min(0.16, -v.y * 0.03)), this.onLand();
        this.height = v.y = 0;
      }
    }
    this.dip += (0 - this.dip) * Math.min(1, dt * 7);
    this.eye += ((crouch ? CROUCH : STAND) - this.eye) * Math.min(1, dt * 9);

    // Footsteps follow the distance actually walked, so the cadence matches walk / sprint.
    let bob = 0;
    if (this.height === 0 && moved > 1e-4) {
      const before = Math.floor(this.stride);
      this.stride += moved / (sprint ? STRIDE * 1.25 : STRIDE);
      if (Math.floor(this.stride) !== before) this.onStep(sprint, onRug(f.x, f.z));
      if (!reducedMotion()) bob = Math.abs(Math.sin(this.stride * Math.PI)) * (sprint ? 0.05 : 0.03);
    }
    const { camera } = this.engine;
    camera.position.set(f.x, this.eye + this.height - this.dip - bob, f.z);
    camera.rotation.set(this.pitch, this.yaw + Math.PI, 0, 'YXZ');
  }

  update(dt: number, t: number) {
    const { camera } = this.engine;
    if (this.busy) return;
    if (this.mode === 'overview') {
      this.controls.update();
      // Keep the camera inside the hall.
      const p = camera.position;
      p.x = THREE.MathUtils.clamp(p.x, -W + 0.7, W - 0.7);
      p.z = THREE.MathUtils.clamp(p.z, -D + 0.7, D - 0.7);
      p.y = THREE.MathUtils.clamp(p.y, 0.7, HALL.h - 0.7);
    } else if (this.mode === 'walk') {
      this.walk(dt);
    } else if (this.seat) {
      const still = reducedMotion();
      const breathe = still ? 0 : Math.sin(t * 1.5) * 0.006;
      const sway = still ? 0 : Math.sin(t * 0.7) * 0.004;
      const s = this.seat;
      camera.position.set(s.x + Math.sin(s.yaw) * 0.06, EYE + breathe, s.z + Math.cos(s.yaw) * 0.06);
      camera.rotation.set(this.pitch + breathe * 0.6, s.yaw + Math.PI + this.yaw + sway, 0, 'YXZ');
    }
  }
}
