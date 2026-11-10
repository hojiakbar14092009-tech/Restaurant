import * as THREE from 'three';
import { canvasTexture, seeded } from './build';

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
// Matte surfaces (walls, fabric, foliage) cover most of the screen and have no visible highlights,
// so they use the much cheaper Lambert shading: this roughly halves the per-pixel lighting cost.
const matte = (p: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(p);

/** Herringbone parquet. The pattern is a lattice of plank pairs with period 2L, so the canvas tiles seamlessly. */
function parquet() {
  const w = 64, L = 256, S = 2 * L;
  const tex = canvasTexture(S, (ctx) => {
    const plank = (x: number, y: number, pw: number, ph: number) => {
      const key = ((((x % S) + S) % S) * 7919 + (((y % S) + S) % S) * 104729 + (pw > ph ? 1 : 0)) | 0;
      const r = seeded(key);
      const tone = 0.78 + r() * 0.3;
      ctx.fillStyle = `rgb(${(118 * tone) | 0},${(76 * tone) | 0},${(44 * tone) | 0})`;
      ctx.fillRect(x, y, pw, ph);
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = '#2a170b';
      for (let i = 0; i < 9; i++) {
        const o = r();
        ctx.beginPath();
        if (pw > ph) (ctx.moveTo(x, y + o * ph), ctx.lineTo(x + pw, y + ((o + r() * 0.08) % 1) * ph));
        else (ctx.moveTo(x + o * pw, y), ctx.lineTo(x + ((o + r() * 0.08) % 1) * pw, y + ph));
        ctx.stroke();
      }
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#1c0f07';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, pw - 1.5, ph - 1.5);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    };
    for (let n = -10; n <= 18; n++)
      for (let m = -6; m <= 6; m++) {
        const x = n * w + m * L, y = n * w - m * L;
        if (x > S || y > S + L || x < -L - w || y < -L) continue;
        plank(x, y, L, w);
        plank(x + L, y - (L - w), w, L);
      }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.rotation = Math.PI / 4;
  return tex;
}

function marble(base: string, vein: string, seed: number) {
  return canvasTexture(512, (ctx, w, h) => {
    const r = seeded(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = vein;
      ctx.globalAlpha = 0.05 + r() * 0.3;
      ctx.lineWidth = 0.4 + r() * 2.2;
      ctx.beginPath();
      let x = r() * w, y = r() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 9; k++) {
        x += (r() - 0.3) * 90;
        y += (r() - 0.5) * 70;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

/** Soft radial glow used for candle light pools, table halos and lamp flares. */
export const glowTexture = canvasTexture(128, (ctx, w) => {
  const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
}, false);

const floorTex = parquet();

export const M = {
  floor: std({ map: floorTex, roughness: 0.42, metalness: 0, envMapIntensity: 0.7 }),
  wall: matte({ color: '#2a231e'  }),
  panel: matte({ color: '#3a2a20'  }),
  ceiling: matte({ color: '#1b1714'  }),
  beam: matte({ color: '#24170f'  }),
  walnut: std({ color: '#3b2416', roughness: 0.48 }),
  darkWood: std({ color: '#1e130c', roughness: 0.5 }),
  marble: std({ map: marble('#cfc7b9', '#6f665a', 3), roughness: 0.18, envMapIntensity: 1.1 }),
  darkMarble: std({ map: marble('#191614', '#b8925a', 9), roughness: 0.14, envMapIntensity: 1.2 }),
  linen: matte({ color: '#c4baa9'  }),
  leather: std({ color: '#6b3f25', roughness: 0.55 }),
  brass: std({ color: '#b8925a', roughness: 0.3, metalness: 1 }),
  steel: std({ color: '#c9c9c9', roughness: 0.22, metalness: 1 }),
  blackMetal: std({ color: '#141210', roughness: 0.45, metalness: 0.8 }),
  porcelain: std({ color: '#f6f1e8', roughness: 0.2 }),
  ceramic: std({ color: '#23302b', roughness: 0.3 }),
  glass: std({ color: '#ffffff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 1.6, depthWrite: false }),
  windowGlass: std({ color: '#cfe3ee', roughness: 0.02, transparent: true, opacity: 0.06, envMapIntensity: 0.12, depthWrite: false }),
  bottle: std({ color: '#ffffff', roughness: 0.12, metalness: 0.1, envMapIntensity: 1.4 }),
  leaf: matte({ color: '#2f5a37'  }),
  wax: matte({ color: '#f3ead7'  }),
  mirror: std({ color: '#d9d2c4', roughness: 0.06, metalness: 1, envMapIntensity: 0.45 }),
  // Velvet is a plain rough material: the physical sheen lobe cost ~15% of the frame on integrated GPUs.
  velvet: matte({ color: '#5a252b'  }),
  velvetDrape: matte({ color: '#6a5237', side: THREE.DoubleSide  }),
  crystal: std({ color: '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.2, envMapIntensity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  /** Vertex-coloured material for merged multi-colour props (food, flowers). */
  painted: matte({ vertexColors: true  }),
  ground: matte({ color: '#1d2a1c'  }),
};
