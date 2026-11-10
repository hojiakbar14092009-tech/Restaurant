import * as THREE from 'three';
import {
  BAR, HALL, HOST_STAND, PLANTS, POINTS, SEAT_LABELS, TABLES, TABLE_RADIUS, seatsOf, serviceAngle, waiterSpot,
  type SeatDef, type TableDef,
} from '../data/config';
import { box, canvasTexture, cyl, instanced, lathe, mat, merge, mesh, seeded, tint } from './build';
import { M, glowTexture } from './materials';

/** Height of every table surface. */
export const TABLE_Y = 0.76;
const D = HALL.d / 2;
type Part = [THREE.BufferGeometry, THREE.Matrix4?];

export interface PickData {
  kind: 'table' | 'seat' | 'menu';
  tableId: number;
  seat?: number;
}
export interface TableGlow {
  rim: THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
}

/** Point in front of a diner: `right`/`forward` are in the diner's own frame (forward = towards the table centre). */
function fromSeat(s: SeatDef, t: TableDef, radius: number, right = 0, forward = 0) {
  const a = Math.atan2(s.z - t.z, s.x - t.x);
  const px = t.x + Math.cos(a) * radius, pz = t.z + Math.sin(a) * radius;
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return { x: px + right * c + forward * sn, z: pz - right * sn + forward * c };
}

const menuTexture = () =>
  canvasTexture([256, 360], (ctx, w, h) => {
    ctx.fillStyle = '#1e1a17';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b8925a';
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#efe6d8';
    ctx.textAlign = 'center';
    ctx.font = '600 40px "Cormorant Garamond", Georgia, serif';
    ctx.fillText('LUMIÈRE', w / 2, 150);
    ctx.fillStyle = '#b8925a';
    ctx.fillRect(w / 2 - 30, 172, 60, 2);
    ctx.font = '500 22px Inter, Arial, sans-serif';
    ctx.fillText('M E N U', w / 2, 215);
  });

/** Floor-length round tablecloth: the skirt flares slightly and falls in soft folds. */
function clothGeometry() {
  const h = TABLE_Y - 0.015;
  const skirt = new THREE.CylinderGeometry(TABLE_RADIUS + 0.012, TABLE_RADIUS + 0.012, h, 96, 10, true).translate(0, TABLE_Y - h / 2, 0);
  const p = skirt.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), drop = (TABLE_Y - p.getY(i)) / h;
    const a = Math.atan2(z, x);
    const r = TABLE_RADIUS + 0.012 + 0.07 * drop + drop ** 1.4 * (0.045 * Math.sin(a * 16) + 0.02 * Math.sin(a * 7 + 1));
    p.setXYZ(i, Math.cos(a) * r, p.getY(i), Math.sin(a) * r);
  }
  skirt.computeVertexNormals();
  return merge([[skirt], [new THREE.CircleGeometry(TABLE_RADIUS + 0.014, 96).rotateX(-Math.PI / 2), mat(0, TABLE_Y, 0)]]);
}

function buildTables(g: THREE.Group, picks: THREE.Object3D[], glows: TableGlow[]) {
  g.add(instanced(clothGeometry(), M.linen, TABLES.map((t) => mat(t.x, 0, t.z))));
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  const rimGeo = new THREE.TorusGeometry(TABLE_RADIUS + 0.03, 0.01, 8, 80).rotateX(Math.PI / 2);
  const haloGeo = new THREE.PlaneGeometry(4.6, 4.6).rotateX(-Math.PI / 2);
  for (const t of TABLES) {
    const proxy = new THREE.Mesh(cyl(TABLE_RADIUS + 0.05, TABLE_RADIUS + 0.05, 0.9, 12), pickMat);
    proxy.position.set(t.x, 0.45, t.z);
    proxy.userData = { kind: 'table', tableId: t.id } satisfies PickData;
    picks.push(proxy);

    const rim = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
    const halo = new THREE.MeshBasicMaterial({ color: 0x000000, map: glowTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const rimMesh = new THREE.Mesh(rimGeo, rim);
    rimMesh.position.set(t.x, TABLE_Y - 0.02, t.z);
    const haloMesh = new THREE.Mesh(haloGeo, halo);
    haloMesh.position.set(t.x, 0.02, t.z);
    haloMesh.renderOrder = 1;
    g.add(proxy, rimMesh, haloMesh);
    glows.push({ rim, halo });
  }
}

/** Upholstered dining chair: velvet seat and tufted back, turned dark-wood legs with brass caps. Faces +z. */
function buildChairs(g: THREE.Group, picks: THREE.Object3D[]) {
  const legs: Part[] = [], caps: Part[] = [];
  for (const sx of [-1, 1]) {
    legs.push([cyl(0.03, 0.017, 0.4, 10), mat(sx * 0.2, 0.2, 0.2)], [cyl(0.022, 0.03, 0.03, 10), mat(sx * 0.2, 0.385, 0.2)]);
    legs.push([cyl(0.024, 0.02, 1.0, 10), mat(sx * 0.2, 0.5, -0.22, 0, 1, -0.1)]);
    caps.push([cyl(0.019, 0.019, 0.035, 10), mat(sx * 0.2, 0.0175, 0.2)], [cyl(0.021, 0.021, 0.035, 10), mat(sx * 0.2, 0.0175, -0.17)]);
    caps.push([new THREE.SphereGeometry(0.03, 10, 8), mat(sx * 0.2, 1.01, -0.27)]); // finials
  }
  legs.push([box(0.46, 0.06, 0.46), mat(0, 0.37, 0)]);
  const velvet = merge([
    [box(0.5, 0.08, 0.49), mat(0, 0.425, 0.005)],
    [cyl(0.04, 0.04, 0.5, 12).rotateZ(Math.PI / 2), mat(0, 0.425, 0.245)], // rolled front edge
    [box(0.44, 0.5, 0.075), mat(0, 0.75, -0.235, 0, 1, -0.1)],
    [cyl(0.0375, 0.0375, 0.44, 12).rotateZ(Math.PI / 2), mat(0, 1.0, -0.26, 0, 1, -0.1)],
  ]);
  // Button tufting on the back and brass piping under the seat.
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) caps.push([new THREE.SphereGeometry(0.011, 8, 6), mat((c - 1) * 0.13, 0.66 + r * 0.17, -0.19 - r * 0.017)]);
  caps.push([box(0.5, 0.012, 0.012), mat(0, 0.385, 0.25)], [box(0.012, 0.012, 0.48), mat(0.25, 0.385, 0)], [box(0.012, 0.012, 0.48), mat(-0.25, 0.385, 0)]);

  const seats = TABLES.flatMap(seatsOf);
  const mx = seats.map((s) => mat(s.x, 0, s.z, s.yaw));
  g.add(instanced(merge(legs), M.darkWood, mx), instanced(velvet, M.velvet, mx), instanced(merge(caps), M.brass, mx, { cast: false }));

  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const s of seats) {
    const proxy = new THREE.Mesh(box(0.52, 1.05, 0.52), pickMat);
    proxy.position.set(s.x, 0.52, s.z);
    proxy.userData = { kind: 'seat', tableId: s.tableId, seat: s.index } satisfies PickData;
    proxy.name = `Table ${s.tableId} seat ${SEAT_LABELS[s.index]}`;
    picks.push(proxy);
    g.add(proxy);
  }
}

/** Candle heights (m) of the three pillar candles in glass hurricanes. */
const CANDLES = [0.09, 0.13, 0.17];

function buildTableware(g: THREE.Group, picks: THREE.Object3D[]) {
  const places: THREE.Matrix4[] = [], centre: THREE.Matrix4[] = [], trios: THREE.Matrix4[] = [], menus: THREE.Matrix4[] = [];
  const flames: THREE.Matrix4[] = [];
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });

  for (const t of TABLES) {
    for (const s of seatsOf(t)) {
      const p = fromSeat(s, t, TABLE_RADIUS - 0.25);
      places.push(mat(p.x, TABLE_Y, p.z, s.yaw));
    }
    const a = serviceAngle(t);
    centre.push(mat(t.x, TABLE_Y, t.z));
    const trio = mat(t.x, TABLE_Y, t.z, -a);
    trios.push(trio);
    CANDLES.forEach((h, i) => {
      const ca = (i / 3) * Math.PI * 2;
      flames.push(trio.clone().multiply(mat(Math.cos(ca) * 0.19, h + 0.022, Math.sin(ca) * 0.19)));
    });
    const mp = { x: t.x + Math.cos(a) * 0.5, z: t.z + Math.sin(a) * 0.5 };
    menus.push(mat(mp.x, TABLE_Y + 0.103, mp.z, waiterSpot(t).yaw, 1, -0.2));
    const proxy = new THREE.Mesh(box(0.22, 0.28, 0.16), pickMat);
    proxy.position.set(mp.x, TABLE_Y + 0.12, mp.z);
    proxy.userData = { kind: 'menu', tableId: t.id } satisfies PickData;
    picks.push(proxy);
    g.add(proxy);
  }

  // One place setting, in the diner's frame (+z towards the table centre): charger, plate, napkin with ring,
  // fork / knife / spoon, wine glass and water glass. Each material is one instanced draw call for all 50 places.
  const charger = lathe([[0, 0.005], [0.14, 0.005], [0.165, 0.013], [0.168, 0.011], [0.14, 0], [0, 0]], 36);
  const ring = new THREE.TorusGeometry(0.027, 0.006, 6, 18);
  g.add(instanced(merge([[charger], [ring, mat(0, 0.052, 0)]]), M.brass, places, { cast: false }));
  const plate = lathe([[0, 0.006], [0.085, 0.006], [0.126, 0.02], [0.13, 0.018], [0.087, 0], [0, 0]], 32);
  g.add(instanced(plate.translate(0, 0.012, 0), M.porcelain, places, { cast: false }));
  g.add(instanced(cyl(0.022, 0.022, 0.17, 10).rotateX(Math.PI / 2).translate(0, 0.05, 0), new THREE.MeshStandardMaterial({ color: '#3a332d', roughness: 0.95 }), places, { cast: false }));
  const handle = (x: number) => [box(0.012, 0.004, 0.19), mat(x, 0.003, 0)] as Part;
  g.add(instanced(merge([
    handle(-0.21), [box(0.024, 0.004, 0.05), mat(-0.21, 0.003, 0.1)], // fork
    handle(0.21), [box(0.018, 0.003, 0.09), mat(0.21, 0.003, 0.07)], // knife
    handle(0.245), [cyl(0.017, 0.017, 0.004, 12), mat(0.245, 0.003, 0.1, 0, [1, 1, 1.4])], // spoon
  ]), M.steel, places, { cast: false }));
  const wine = lathe([[0, 0], [0.036, 0], [0.036, 0.004], [0.005, 0.01], [0.005, 0.09], [0.03, 0.11], [0.042, 0.16], [0.035, 0.205]], 20);
  const water = lathe([[0, 0], [0.032, 0], [0.038, 0.11], [0.036, 0.11], [0.03, 0.006], [0, 0.006]], 20);
  const glassware = instanced(merge([[wine, mat(0.19, 0, 0.2)], [water, mat(0.1, 0, 0.25)]]), M.crystal, places, { cast: false, receive: false });
  glassware.renderOrder = 3;
  g.add(glassware);

  // Low centrepiece: a small vase with flowers, kept under eye level.
  const vase = lathe([[0, 0], [0.04, 0], [0.058, 0.04], [0.05, 0.085], [0.03, 0.11], [0.036, 0.125]], 20);
  g.add(instanced(vase, M.ceramic, centre, { cast: false }));
  const flowers: Part[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, lean = 0.25 + (i % 3) * 0.16, hgt = 0.1 + (i % 3) * 0.035;
    flowers.push([tint(cyl(0.003, 0.003, hgt, 5), '#3d6a3f'), mat(Math.sin(a) * lean * 0.08, 0.11 + hgt / 2, Math.cos(a) * lean * 0.08, a, 1, lean)]);
    flowers.push([tint(new THREE.IcosahedronGeometry(0.026, 1), i % 3 ? '#f1e3d3' : '#d8a48f'), mat(Math.sin(a) * lean * 0.26, 0.12 + hgt, Math.cos(a) * lean * 0.26)]);
  }
  g.add(instanced(merge(flowers), M.painted, centre, { cast: false }));

  // Exactly three pillar candles of different heights in glass hurricanes, around the vase.
  const wax: Part[] = [], hurricanes: Part[] = [], bases: Part[] = [];
  CANDLES.forEach((h, i) => {
    const a = (i / 3) * Math.PI * 2, x = Math.cos(a) * 0.19, z = Math.sin(a) * 0.19;
    wax.push([cyl(0.027, 0.027, h, 14), mat(x, h / 2 + 0.006, z)]);
    hurricanes.push([new THREE.CylinderGeometry(0.05, 0.044, h + 0.08, 18, 1, true), mat(x, (h + 0.08) / 2 + 0.006, z)]);
    bases.push([cyl(0.054, 0.058, 0.008, 18), mat(x, 0.004, z)]);
  });
  g.add(instanced(merge(wax), M.wax, trios, { cast: false }), instanced(merge(bases), M.brass, trios, { cast: false }));
  const glass = instanced(merge(hurricanes), M.crystal, trios, { cast: false, receive: false });
  glass.renderOrder = 3;
  g.add(glass);

  g.add(instanced(box(0.15, 0.21, 0.006), new THREE.MeshStandardMaterial({ map: menuTexture(), roughness: 0.7 }), menus, { cast: false }));
  return flames;
}

/**
 * Candle flames (animated in the vertex shader: flicker + sway, one draw call for all 30) and a warm
 * pool of light on each tablecloth. No real lights here: see HallLights for the few shared ones.
 */
export function buildCandleLight(flamesAt: THREE.Matrix4[]) {
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `uniform float time; varying float vH;
      void main(){
        float phase = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 5.7 + instanceMatrix[3].y * 40.0;
        float flick = sin(time * 11.0 + phase) * sin(time * 6.3 + phase * 1.7);
        vec3 p = position;
        vH = p.y + 0.5;
        p.y *= 1.0 + 0.16 * flick;
        p.x += vH * vH * 0.45 * sin(time * 3.1 + phase);
        p.z += vH * vH * 0.3 * sin(time * 2.3 + phase * 0.6);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vH;
      void main(){
        vec3 c = mix(vec3(4.0, 3.2, 1.6), vec3(3.4, 1.3, 0.3), smoothstep(0.1, 0.95, vH));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // A teardrop: a sphere stretched upwards, 1 unit tall before the instance scale.
  const drop = new THREE.SphereGeometry(0.5, 10, 10);
  const dp = drop.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const y = dp.getY(i) + 0.5, k = 1 - 0.75 * y * y;
    dp.setXYZ(i, dp.getX(i) * k, dp.getY(i), dp.getZ(i) * k);
  }
  const flames = instanced(drop, flameMat, flamesAt.map((m) => m.clone().multiply(mat(0, 0, 0, 0, [0.02, 0.042, 0.02]))), { cast: false, receive: false });
  flames.frustumCulled = false;
  const poolMat = new THREE.MeshBasicMaterial({ color: '#ff9a45', map: glowTexture, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = instanced(new THREE.PlaneGeometry(2.3, 2.3).rotateX(-Math.PI / 2), poolMat, TABLES.map((t) => mat(t.x, TABLE_Y + 0.004, t.z)), { cast: false, receive: false });
  pools.renderOrder = 2;
  return { flames, pools, flameMat, poolMat };
}

function buildBar(g: THREE.Group) {
  const cx = (BAR.x0 + BAR.x1) / 2, len = BAR.x1 - BAR.x0, cz = (BAR.z0 + BAR.z1) / 2;
  g.add(mesh(box(len, 1.02, 0.62).translate(cx, 0.51, cz), M.walnut));
  g.add(mesh(box(len + 0.2, 0.05, 0.82).translate(cx, 1.065, cz - 0.04), M.darkMarble));
  const fluting: THREE.Matrix4[] = [];
  for (let x = BAR.x0 + 0.15; x < BAR.x1; x += 0.3) fluting.push(mat(x, 0.52, BAR.z0 - 0.012, 0, [0.2, 0.86, 0.02]));
  g.add(instanced(box(1, 1, 1), M.darkWood, fluting, { cast: false }));
  g.add(mesh(merge([
    [cyl(0.018, 0.018, len, 10).rotateZ(Math.PI / 2), mat(cx, 0.2, BAR.z0 - 0.12)],
    [box(len + 0.2, 0.02, 0.02), mat(cx, 1.03, BAR.z0 - 0.45 + 0.01)],
  ]), M.brass, { cast: false }));

  // Back bar: four shelves of bottles in front of a warm backlit panel.
  const wallZ = D - 0.04;
  const shelves: THREE.Matrix4[] = [], bottles: THREE.Matrix4[] = [];
  const rnd = seeded(21);
  for (let s = 0; s < 4; s++) {
    const y = 1.35 + s * 0.52;
    shelves.push(mat(cx, y, wallZ - 0.14, 0, [len - 0.4, 0.03, 0.26]));
    for (let x = BAR.x0 + 0.4; x < BAR.x1 - 0.3; x += 0.13 + rnd() * 0.12)
      bottles.push(mat(x, y + 0.015, wallZ - 0.1 - rnd() * 0.08, rnd() * 6, [1, 0.8 + rnd() * 0.5, 1]));
  }
  g.add(instanced(box(1, 1, 1), M.darkWood, shelves, { cast: false }));
  const bottle = lathe([[0, 0], [0.036, 0], [0.038, 0.17], [0.014, 0.23], [0.013, 0.29], [0.016, 0.3]], 12);
  g.add(instanced(bottle, M.bottle, bottles, { cast: false }, ['#6b3a12', '#1f3d25', '#b8925a', '#d9cdb8', '#3a1410', '#274a55']));
  const backlight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.82, 0.36) });
  g.add(mesh(merge([
    [box(len - 0.3, 2.25, 0.02), mat(cx, 2.3, wallZ - 0.005)],
    [box(len + 0.2, 0.03, 0.03), mat(cx, 0.06, BAR.z0 - 0.03)],
  ]), backlight, { cast: false, receive: false }));

  const stool = merge([
    [cyl(0.03, 0.03, 0.72, 10), mat(0, 0.38, 0)],
    [cyl(0.2, 0.22, 0.025, 24), mat(0, 0.0125, 0)],
    [new THREE.TorusGeometry(0.15, 0.012, 6, 24).rotateX(Math.PI / 2), mat(0, 0.3, 0)],
  ]);
  const sm = BAR.stools.map((x) => mat(x, 0, BAR.stoolZ));
  g.add(instanced(stool, M.brass, sm), instanced(cyl(0.2, 0.17, 0.09, 24).translate(0, 0.78, 0), M.velvet, sm));
}

function buildDecor(g: THREE.Group) {
  // Large potted olive trees.
  const pot = lathe([[0, 0], [0.28, 0], [0.36, 0.62], [0.32, 0.62], [0.28, 0.08], [0, 0.08]], 20);
  const pm = PLANTS.map((p, i) => mat(p.x, 0, p.z, i * 1.3));
  g.add(instanced(pot, M.blackMetal, pm));
  const rnd = seeded(3);
  const leaves: Part[] = [[cyl(0.035, 0.06, 1.7, 6), mat(0, 1.4, 0)]];
  for (let i = 0; i < 34; i++) {
    const a = rnd() * 6.28, r = 0.15 + rnd() * 0.55, y = 2.0 + rnd() * 1.3;
    leaves.push([new THREE.IcosahedronGeometry(0.2 + rnd() * 0.14, 0), mat(Math.cos(a) * r, y, Math.sin(a) * r, a, [1, 0.5, 1.5], rnd() - 0.5)]);
  }
  g.add(instanced(merge(leaves), M.leaf, pm));

  // Decorative urns on plinths, flanking the entrance and the bar.
  const urn = merge([
    [box(0.5, 0.7, 0.5), mat(0, 0.35, 0)],
    [lathe([[0, 0], [0.1, 0], [0.07, 0.06], [0.2, 0.2], [0.24, 0.42], [0.14, 0.6], [0.11, 0.66], [0.18, 0.72], [0.16, 0.74]], 20), mat(0, 0.7, 0)],
  ]);
  g.add(instanced(urn, M.darkMarble, [mat(POINTS.door.x - 1.7, 0, D - 0.5), mat(POINTS.door.x + 1.7, 0, D - 0.5), mat(BAR.x0 - 0.7, 0, D - 0.5), mat(BAR.x1 + 0.6, 0, D - 0.5)]));

  // Host stand with a small brass lamp.
  const hs = HOST_STAND;
  g.add(mesh(merge([
    [box(0.6, 1.05, 0.45), mat(hs.x, 0.525, hs.z)],
    [box(0.7, 0.04, 0.55), mat(hs.x, 1.09, hs.z, 0, 1, 0.18)],
  ]), M.walnut));
  g.add(mesh(merge([
    [cyl(0.06, 0.07, 0.02, 16), mat(hs.x + 0.22, 1.12, hs.z + 0.14)],
    [cyl(0.008, 0.008, 0.26, 6), mat(hs.x + 0.22, 1.25, hs.z + 0.14)],
    [box(0.62, 0.012, 0.02), mat(hs.x, 1.0, hs.z - 0.23)],
  ]), M.brass, { cast: false }));

  // Runner carpet from the entrance.
  const carpet = mesh(new THREE.PlaneGeometry(2.0, 4.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4a1f1a', roughness: 1 }), { cast: false });
  carpet.position.set(POINTS.door.x, 0.012, D - 2.3);
  g.add(carpet);
}

const DISHES = (() => {
  const lumps = (n: number, y: number, r: number, color: string, spread: number) =>
    Array.from({ length: n }, (_, i) => [tint(new THREE.IcosahedronGeometry(r, 0), color), mat(Math.cos(i * 2.4) * spread, y + (i % 2) * 0.012, Math.sin(i * 2.4) * spread, i)] as Part);
  const bucket = merge([
    [tint(cyl(0.078, 0.056, 0.13, 20), '#efe6d8'), mat(0, 0.065, 0)],
    [tint(cyl(0.074, 0.066, 0.03, 20), '#a8322a'), mat(0, 0.085, 0, 0, [1.03, 1, 1.03])],
    ...lumps(6, 0.135, 0.034, '#b06a28', 0.04),
  ]);
  const burger = merge([
    [tint(cyl(0.056, 0.05, 0.022, 20), '#c98a45'), mat(0, 0.03, 0)],
    [tint(cyl(0.06, 0.06, 0.008, 20), '#5b8f3a'), mat(0, 0.045, 0)],
    [tint(cyl(0.056, 0.056, 0.018, 20), '#4a2a18'), mat(0, 0.058, 0)],
    [tint(box(0.105, 0.006, 0.105), '#e8b23a'), mat(0, 0.07, 0, 0.6)],
    [tint(new THREE.SphereGeometry(0.057, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#c98a45'), mat(0, 0.073, 0, 0, [1, 0.62, 1])],
  ]);
  const fries = merge([
    [tint(box(0.075, 0.075, 0.035), '#a8322a'), mat(0, 0.058, 0)],
    ...Array.from({ length: 9 }, (_, i) => [tint(box(0.009, 0.075, 0.009), '#e6b85c'), mat(-0.028 + (i % 5) * 0.014, 0.115 + (i % 3) * 0.008, (i % 2) * 0.012 - 0.006, 0, 1, 0, (i - 4) * 0.05)] as Part),
  ]);
  const drink = merge([
    [tint(cyl(0.036, 0.028, 0.125, 16), '#efe6d8'), mat(0, 0.0625, 0)],
    [tint(cyl(0.038, 0.038, 0.01, 16), '#1e1a17'), mat(0, 0.13, 0)],
    [tint(cyl(0.004, 0.004, 0.09, 6), '#b8925a'), mat(0.01, 0.165, 0, 0, 1, 0, 0.15)],
  ]);
  return [bucket, burger, fries, drink];
})();

/** Dishes that appear on a table after a waiter delivers an order. */
export class FoodLayer {
  readonly group = new THREE.Group();
  private shown = new Map<number, THREE.Mesh[]>();
  private growing: THREE.Mesh[] = [];

  set(tableId: number, count: number) {
    const list = this.shown.get(tableId) ?? [];
    if (list.length === count) return;
    this.shown.set(tableId, list);
    while (list.length > count) this.group.remove(list.pop()!);
    const t = TABLES[tableId - 1];
    const seats = seatsOf(t);
    while (list.length < count) {
      const i = list.length;
      const p = i < seats.length ? fromSeat(seats[i], t, TABLE_RADIUS - 0.25) : fromSeat(seats[i - seats.length], t, 0.42, 0.2);
      const dish = mesh(DISHES[(i + tableId) % DISHES.length], M.painted, { cast: true });
      dish.position.set(p.x, TABLE_Y + (i < seats.length ? 0.02 : 0), p.z);
      dish.scale.setScalar(0.001);
      this.group.add(dish);
      this.growing.push(dish);
      list.push(dish);
    }
  }
  /** Pop-in animation for freshly delivered dishes. */
  update(dt: number) {
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const d = this.growing[i], s = Math.min(1, d.scale.x + dt * 3);
      d.scale.setScalar(s);
      if (s === 1) this.growing.splice(i, 1);
    }
  }
}

export function buildFurniture() {
  const group = new THREE.Group();
  const picks: THREE.Object3D[] = [];
  const glows: TableGlow[] = [];
  buildTables(group, picks, glows);
  buildChairs(group, picks);
  const flames = buildTableware(group, picks);
  buildBar(group);
  buildDecor(group);
  return { group, picks, glows, flames };
}
