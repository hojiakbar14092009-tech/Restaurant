import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { HALL } from '../data/config';
import { box, canvasTexture, cyl, instanced, mat, merge, mesh, seeded } from './build';
import { M, glowTexture } from './materials';

/** Everything seen through the windows: sky, stars, moon, street, trees, lamps and a distant skyline. */
export function buildExterior() {
  const group = new THREE.Group();
  const rnd = seeded(77);

  const sky = new Sky();
  sky.scale.setScalar(1000);
  // Objects are sorted by their centre, so the sky and the ground would be drawn first and their (costly)
  // shaders would run on every pixel before being painted over. Drawing them last lets the depth test skip those.
  sky.renderOrder = 10;
  group.add(sky);

  // Stars: fixed-size points on a far sphere.
  const starPos = new Float32Array(1400 * 3);
  for (let i = 0; i < 1400; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    starPos.set([Math.cos(a) * r * 450, Math.abs(u) * 450 + 4, Math.sin(a) * r * 450], i * 3);
  }
  const starGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  group.add(new THREE.Points(starGeo, starMat));

  const moonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.5), fog: false, transparent: true });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), moonMat);
  group.add(moon);

  // Ground and a street running along the south side.
  const ground = mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), M.ground, { cast: false });
  ground.position.y = -0.02;
  ground.renderOrder = 9;
  group.add(ground);
  const road = mesh(new THREE.PlaneGeometry(400, 7).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#17191b', roughness: 0.6 }), { cast: false });
  road.position.set(0, -0.01, -HALL.d / 2 - 11);
  road.renderOrder = 9;
  group.add(road);
  const terrace = mesh(new THREE.PlaneGeometry(HALL.w + 10, HALL.d + 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2b2826', roughness: 0.9 }), { cast: false });
  terrace.position.y = -0.005;
  terrace.renderOrder = 9;
  group.add(terrace);

  // Trees around the building.
  const trunks: THREE.Matrix4[] = [], crowns: THREE.Matrix4[] = [];
  for (let i = 0; i < 64; i++) {
    const a = rnd() * Math.PI * 2, r = 11.5 + rnd() * 30;
    const x = Math.cos(a) * r * 1.25, z = Math.sin(a) * r;
    if (Math.abs(z + HALL.d / 2 + 11) < 5) continue; // keep the road clear
    if (Math.abs(x) < HALL.w / 2 + 3 && Math.abs(z) < HALL.d / 2 + 3) continue; // and the building itself
    const s = 0.8 + rnd() * 0.9;
    trunks.push(mat(x, 1.4 * s, z, 0, [s, s, s]));
    crowns.push(mat(x, 4.2 * s, z, rnd() * 6, [s * (0.9 + rnd() * 0.4), s * (1 + rnd() * 0.5), s]));
  }
  group.add(instanced(cyl(0.16, 0.24, 2.8, 7), new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 1 }), trunks, { cast: false }));
  group.add(instanced(new THREE.IcosahedronGeometry(2, 1), new THREE.MeshStandardMaterial({ color: '#2c4a2e', roughness: 1, flatShading: true }), crowns, { cast: false }));

  // Street lamps along the road and the terrace: they switch on at dusk.
  const poles: THREE.Matrix4[] = [], bulbs: THREE.Matrix4[] = [], pools: THREE.Matrix4[] = [];
  const lampAt = (x: number, z: number) => {
    poles.push(mat(x, 0, z));
    bulbs.push(mat(x, 4.25, z));
    pools.push(mat(x, 0.02, z));
  };
  for (let x = -42; x <= 42; x += 12) lampAt(x, -HALL.d / 2 - 6.6);
  for (const z of [-3, 5]) (lampAt(-HALL.w / 2 - 6, z), lampAt(HALL.w / 2 + 6, z));
  const pole = merge([[cyl(0.05, 0.08, 4.1, 8), mat(0, 2.05, 0)], [cyl(0.18, 0.05, 0.12, 10), mat(0, 4.14, 0)], [box(0.3, 0.3, 0.3), mat(0, 0.15, 0)]]);
  group.add(instanced(pole, M.blackMetal, poles, { cast: false }));
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  group.add(instanced(new THREE.SphereGeometry(0.17, 12, 10), lampMat, bulbs, { cast: false, receive: false }));
  const lampPoolMat = new THREE.MeshBasicMaterial({ color: '#ffb76a', map: glowTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  group.add(instanced(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2), lampPoolMat, pools, { cast: false, receive: false }));

  // Distant skyline with windows that light up at night.
  const windowsTex = canvasTexture([64, 128], (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const r = seeded(9);
    for (let y = 4; y < h - 4; y += 8)
      for (let x = 4; x < w - 4; x += 8)
        if (r() > 0.45) {
          ctx.fillStyle = r() > 0.3 ? '#ffd9a0' : '#cfe4ff';
          ctx.globalAlpha = 0.4 + r() * 0.6;
          ctx.fillRect(x, y, 4, 5);
        }
  });
  windowsTex.wrapS = windowsTex.wrapT = THREE.RepeatWrapping;
  windowsTex.repeat.set(2, 3);
  windowsTex.magFilter = THREE.NearestFilter;
  const cityMat = new THREE.MeshStandardMaterial({ color: '#3d444d', roughness: 0.9, emissive: '#ffffff', emissiveMap: windowsTex, emissiveIntensity: 0 });
  const towers: THREE.Matrix4[] = [];
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + rnd() * 0.05, r = 95 + rnd() * 120;
    const h = 14 + rnd() * rnd() * 70, w = 9 + rnd() * 12;
    towers.push(mat(Math.cos(a) * r, h / 2, Math.sin(a) * r, rnd() * 3, [w, h, w]));
  }
  group.add(instanced(box(1, 1, 1), cityMat, towers, { cast: false, receive: false }));

  return { group, sky, starMat, moon, moonMat, lampMat, lampPoolMat, cityMat };
}
