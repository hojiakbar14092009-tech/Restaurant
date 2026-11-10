import * as THREE from 'three';
import { HALL, POINTS } from '../data/config';
import { box, canvasTexture, cyl, instanced, mat, merge, mesh, seeded } from './build';
import { M } from './materials';

const W = HALL.w / 2, D = HALL.d / 2, H = HALL.h;
/** Round-arched panoramic windows: a 3 m wide opening with a semicircular top, 6.7 m tall. */
const ARCH = { width: 3.0, y0: 0.15, spring: 5.2, radius: 1.5, bay: 4.5 };
/** Vertical extent used for the light shafts (the arch is approximated by its mean height). */
export const WINDOW = { y0: ARCH.y0, y1: ARCH.spring + ARCH.radius * 0.75 };
export interface WindowDef {
  /** Centre of the opening on the wall plane. */
  x: number;
  z: number;
  /** Inward normal. */
  nx: number;
  nz: number;
  width: number;
}
export const WINDOWS: WindowDef[] = [];
export const DOOR = { x: POINTS.door.x, width: 2.0, height: 2.9 };

type Parts = [THREE.BufferGeometry, THREE.Matrix4][];

function archShape(cx: number, inset = 0) {
  const w = ARCH.width / 2 - inset, s = new THREE.Path();
  s.moveTo(cx - w, ARCH.y0 + inset);
  s.lineTo(cx + w, ARCH.y0 + inset);
  s.lineTo(cx + w, ARCH.spring);
  s.absarc(cx, ARCH.spring, w, 0, Math.PI, false);
  s.lineTo(cx - w, ARCH.y0 + inset);
  return s;
}

function artTexture(seed: number) {
  return canvasTexture([256, 340], (ctx, w, h) => {
    const r = seeded(seed);
    ctx.fillStyle = '#e9dfcd';
    ctx.fillRect(0, 0, w, h);
    const palette = ['#1e1a17', '#b8925a', '#7a4a2b', '#2f3d33', '#c9b8a0'];
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = palette[(r() * palette.length) | 0];
      ctx.globalAlpha = 0.55 + r() * 0.4;
      ctx.beginPath();
      if (r() > 0.5) ctx.ellipse(r() * w, r() * h, 20 + r() * 70, 20 + r() * 90, r() * 3, 0, Math.PI * 2);
      else ctx.rect(r() * w * 0.8, r() * h * 0.8, 30 + r() * 110, 20 + r() * 140);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/** Gathered floor-length curtain: a pleated sheet pinched at the tie-back. */
function curtainGeometry() {
  const g = new THREE.PlaneGeometry(0.95, 6.5, 18, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) + 3.25; // 0..6.5 from the floor
    const pinch = 1 - 0.5 * Math.exp(-(((y - 1.7) / 0.9) ** 2));
    p.setX(i, x * pinch);
    p.setZ(i, Math.sin(x * 21) * 0.07 * pinch + 0.05);
  }
  g.translate(0, 3.25 + 0.05, 0);
  g.computeVertexNormals();
  return g;
}

/** Grand double-height hall: arched window walls, coffered ceiling, boiserie, pilasters and the entrance. */
export function buildRoom(): THREE.Group {
  const g = new THREE.Group();
  const panel: Parts = [], brass: Parts = [], dark: Parts = [], wall: Parts = [], glass: Parts = [];
  const frames: THREE.Matrix4[] = [], arcs: THREE.Matrix4[] = [], curtains: THREE.Matrix4[] = [], ties: THREE.Matrix4[] = [];
  const unit = box(1, 1, 1);

  M.floor.map!.repeat.set(HALL.w / 1.05, HALL.d / 1.05);
  g.add(mesh(new THREE.PlaneGeometry(HALL.w, HALL.d).rotateX(-Math.PI / 2), M.floor, { cast: false }));
  // Marble border with a brass inlay line around the parquet.
  const border: Parts = [];
  for (const s of [-1, 1]) {
    border.push([box(HALL.w, 0.01, 0.9), mat(0, 0.004, s * (D - 0.45))], [box(0.9, 0.01, HALL.d - 1.8), mat(s * (W - 0.45), 0.004, 0)]);
    brass.push([box(HALL.w - 1.9, 0.012, 0.035), mat(0, 0.004, s * (D - 0.95))], [box(0.035, 0.012, HALL.d - 1.9), mat(s * (W - 0.95), 0.004, 0)]);
  }
  g.add(mesh(merge(border), M.darkMarble, { cast: false }));

  // ----- three walls of arched windows (local frame: x along the wall, z = inward)
  const walls: [number, THREE.Matrix4][] = [
    [HALL.w, mat(0, 0, -D)], // south
    [HALL.d, mat(-W, 0, 0, Math.PI / 2)], // east
    [HALL.d, mat(W, 0, 0, -Math.PI / 2)], // west
  ];
  const paneGeo = new THREE.ShapeGeometry(new THREE.Shape(archShape(0, 0.02).getPoints(20)), 20);
  const panes: THREE.Matrix4[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const [length, wm] of walls) {
    const at = (m: THREE.Matrix4) => wm.clone().multiply(m);
    const count = Math.round(length / ARCH.bay);
    const shape = new THREE.Shape();
    shape.moveTo(-length / 2 - 0.2, 0);
    shape.lineTo(length / 2 + 0.2, 0);
    shape.lineTo(length / 2 + 0.2, H);
    shape.lineTo(-length / 2 - 0.2, H);
    for (let i = 0; i < count; i++) {
      const cx = -length / 2 + (i + 0.5) * ARCH.bay;
      shape.holes.push(archShape(cx));
      v.set(cx, 0, 0).applyMatrix4(wm);
      n.set(0, 0, 1).transformDirection(wm);
      WINDOWS.push({ x: v.x, z: v.z, nx: Math.round(n.x), nz: Math.round(n.z), width: ARCH.width });
      panes.push(at(mat(cx, 0, -0.16)));
      // Mullions: two verticals, transoms, and a fan in the arch.
      const hh = ARCH.spring - ARCH.y0;
      for (const dx of [-0.5, 0.5]) frames.push(at(mat(cx + dx, ARCH.y0 + hh / 2, -0.16, 0, [0.045, hh, 0.06])));
      for (const y of [ARCH.y0 + 0.03, 1.45, 2.7, 3.95, ARCH.spring]) frames.push(at(mat(cx, y, -0.16, 0, [ARCH.width, 0.05, 0.06])));
      for (const dx of [-1, 1]) frames.push(at(mat(cx + dx * (ARCH.width / 2 - 0.03), ARCH.y0 + hh / 2, -0.16, 0, [0.07, hh, 0.09])));
      for (let k = 1; k < 6; k++) {
        const a = (k / 6) * Math.PI;
        frames.push(at(mat(cx + (Math.cos(a) * ARCH.radius) / 2, ARCH.spring + (Math.sin(a) * ARCH.radius) / 2, -0.16, 0, [0.04, ARCH.radius, 0.05], 0, a - Math.PI / 2)));
      }
      arcs.push(at(mat(cx, ARCH.spring, -0.16)), at(mat(cx, ARCH.spring, -0.16, 0, 0.45)));
      // Heavy curtains gathered at both sides, with brass tie-backs.
      for (const s of [-1, 1]) {
        curtains.push(at(mat(cx + s * (ARCH.width / 2 + 0.12), 0, 0.14, 0, [s, 1, 1])));
        ties.push(at(mat(cx + s * (ARCH.width / 2 + 0.12), 1.75, 0.2)));
      }
    }
    const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, curveSegments: 20 }).translate(0, 0, -0.35).applyMatrix4(wm);
    g.add(mesh(wallGeo, M.wall));
    // Pilasters with capitals between the windows, crown moulding and baseboard.
    for (let i = 0; i <= count; i++) {
      const x = -length / 2 + i * ARCH.bay;
      panel.push([unit, at(mat(x, (H - 0.5) / 2, 0.08, 0, [0.62, H - 0.5, 0.16]))], [unit, at(mat(x, 0.3, 0.11, 0, [0.76, 0.6, 0.22]))]);
      panel.push([unit, at(mat(x, H - 0.95, 0.12, 0, [0.84, 0.36, 0.24]))]);
      brass.push([unit, at(mat(x, H - 1.16, 0.125, 0, [0.88, 0.05, 0.26]))], [unit, at(mat(x, H - 0.74, 0.125, 0, [0.88, 0.05, 0.26]))], [unit, at(mat(x, 0.62, 0.115, 0, [0.78, 0.035, 0.23]))]);
    }
    panel.push([unit, at(mat(0, H - 0.25, 0.16, 0, [length, 0.5, 0.32]))], [unit, at(mat(0, 0.09, 0.03, 0, [length, 0.18, 0.06]))]);
    brass.push([unit, at(mat(0, H - 0.52, 0.2, 0, [length, 0.04, 0.34]))]);
  }
  const glassMesh = instanced(paneGeo, M.windowGlass, panes, { cast: false, receive: false });
  glassMesh.renderOrder = 2;
  g.add(glassMesh);
  g.add(instanced(unit, M.blackMetal, frames, { cast: true, receive: false }));
  g.add(instanced(new THREE.TorusGeometry(ARCH.radius - 0.03, 0.035, 6, 28, Math.PI), M.blackMetal, arcs, { cast: false, receive: false }));
  const curtainMesh = instanced(curtainGeometry(), M.velvetDrape, curtains);
  g.add(curtainMesh, instanced(new THREE.TorusGeometry(0.2, 0.018, 6, 20).rotateX(Math.PI / 2), M.brass, ties, { cast: false }));

  // ----- north wall: solid, with the entrance opening
  const dl = DOOR.x - DOOR.width / 2, dr = DOOR.x + DOOR.width / 2, nz = D + 0.175;
  wall.push([box(dl + W + 0.2, H, 0.35), mat((dl - W - 0.2) / 2, H / 2, nz)]);
  wall.push([box(W - dr + 0.2, H, 0.35), mat((dr + W + 0.2) / 2, H / 2, nz)]);
  wall.push([box(DOOR.width, H - DOOR.height, 0.35), mat(DOOR.x, (H + DOOR.height) / 2, nz)]);
  // Boiserie: wainscot, tall upper panels with brass beading, dado rail, crown and baseboard.
  for (let x = -W + 0.5; x < W - 1; x += 1.5) {
    if (x + 1.3 > dl - 0.2 && x < dr + 0.2) continue;
    panel.push([box(1.25, 0.95, 0.04), mat(x + 0.62, 0.72, D - 0.02)], [box(1.25, 3.9, 0.03), mat(x + 0.62, 3.45, D - 0.015)]);
    brass.push([box(1.05, 0.012, 0.012), mat(x + 0.62, 5.25, D - 0.036)], [box(1.05, 0.012, 0.012), mat(x + 0.62, 1.65, D - 0.036)]);
    panel.push([box(1.25, 1.6, 0.03), mat(x + 0.62, 6.45, D - 0.015)]);
  }
  brass.push([box(HALL.w, 0.03, 0.035), mat(0, 1.3, D - 0.02)]);
  panel.push([box(HALL.w, 0.5, 0.32), mat(0, H - 0.25, D - 0.16)], [box(HALL.w, 0.18, 0.06), mat(0, 0.09, D - 0.03)]);
  brass.push([box(HALL.w, 0.04, 0.34), mat(0, H - 0.52, D - 0.2)]);
  // Door frame and two open glazed leaves.
  dark.push([box(0.12, DOOR.height, 0.42), mat(dl, DOOR.height / 2, nz)], [box(0.12, DOOR.height, 0.42), mat(dr, DOOR.height / 2, nz)]);
  dark.push([box(DOOR.width + 0.12, 0.12, 0.42), mat(DOOR.x, DOOR.height, nz)]);
  for (const s of [-1, 1]) {
    const hx = DOOR.x + s * (DOOR.width / 2 - 0.04), lz = D - DOOR.width / 4;
    dark.push([box(0.05, DOOR.height - 0.1, 0.08), mat(hx, DOOR.height / 2, lz - DOOR.width / 4 + 0.04)], [box(0.05, DOOR.height - 0.1, 0.08), mat(hx, DOOR.height / 2, lz + DOOR.width / 4 - 0.04)]);
    dark.push([box(0.05, 0.14, DOOR.width / 2), mat(hx, 0.1, lz)], [box(0.05, 0.1, DOOR.width / 2), mat(hx, DOOR.height - 0.1, lz)]);
    glass.push([box(0.02, DOOR.height - 0.2, DOOR.width / 2 - 0.1), mat(hx, DOOR.height / 2, lz)]);
    brass.push([cyl(0.014, 0.014, 0.6, 8), mat(hx - s * 0.05, 1.15, lz - DOOR.width / 4 + 0.14)]);
  }
  // Kitchen pass door (closed, with a lit porthole).
  const kx = POINTS.kitchen.x;
  dark.push([box(1.2, 2.4, 0.08), mat(kx, 1.2, D - 0.04)]);
  brass.push([box(1.2, 0.3, 0.09), mat(kx, 0.16, D - 0.04)], [new THREE.TorusGeometry(0.2, 0.02, 8, 28), mat(kx, 1.65, D - 0.085)]);
  const porthole = mesh(new THREE.CircleGeometry(0.19, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.0) }), { cast: false, receive: false });
  porthole.position.set(kx, 1.65, D - 0.085);
  porthole.rotation.y = Math.PI;
  g.add(porthole);

  // ----- coffered ceiling with gilded trim, under a roof slab that keeps the sun out
  wall.push([box(HALL.w + 0.8, 0.3, HALL.d + 0.8), mat(0, H + 0.15, 0)]);
  const beams: THREE.Matrix4[] = [], trims: THREE.Matrix4[] = [];
  for (let x = -W + ARCH.bay; x < W - 1; x += ARCH.bay) (beams.push(mat(x, H - 0.2, 0, 0, [0.36, 0.4, HALL.d])), trims.push(mat(x, H - 0.41, 0, 0, [0.2, 0.025, HALL.d])));
  for (let z = -D + ARCH.bay; z < D - 1; z += ARCH.bay) (beams.push(mat(0, H - 0.2, z, 0, [HALL.w, 0.4, 0.36])), trims.push(mat(0, H - 0.41, z, 0, [HALL.w, 0.025, 0.2])));
  g.add(instanced(unit, M.beam, beams, { cast: false }), instanced(unit, M.brass, trims, { cast: false, receive: false }));
  const ceiling = mesh(new THREE.PlaneGeometry(HALL.w, HALL.d).rotateX(Math.PI / 2), M.ceiling, { cast: false });
  ceiling.position.y = H - 0.001;
  g.add(ceiling);

  // ----- framed artwork and mirrors between the entrance and the bar
  const frameGeo = merge([
    [box(1.44, 0.07, 0.06), mat(0, 0.92, 0)], [box(1.44, 0.07, 0.06), mat(0, -0.92, 0)],
    [box(0.07, 1.9, 0.06), mat(0.72, 0, 0)], [box(0.07, 1.9, 0.06), mat(-0.72, 0, 0)],
  ]);
  const frameAt: THREE.Matrix4[] = [];
  [-5.4, -3.3, -1.2, 0.9].forEach((x, i) => {
    const material = i % 2 ? M.mirror : new THREE.MeshStandardMaterial({ map: artTexture(11 + i * 7), roughness: 0.8 });
    const art = mesh(new THREE.PlaneGeometry(1.4, 1.8), material, { cast: false });
    art.position.set(x, 3.2, D - 0.045);
    art.rotation.y = Math.PI;
    g.add(art);
    frameAt.push(mat(x, 3.2, D - 0.05));
  });
  g.add(instanced(frameGeo, M.brass, frameAt, { cast: false }));

  g.add(mesh(merge(wall), M.wall), mesh(merge(panel), M.panel, { cast: false }), mesh(merge(brass), M.brass, { cast: false }), mesh(merge(dark), M.darkWood));
  const doorGlass = mesh(merge(glass), M.windowGlass, { cast: false, receive: false });
  doorGlass.renderOrder = 2;
  g.add(doorGlass);
  return g;
}
