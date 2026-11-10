import { BAR, HALL, HOST_STAND, PLANTS, TABLES, TABLE_CLEARANCE, type Pt } from '../data/config';

/** Uniform grid with A* (8-connected, no corner cutting) and line-of-sight path smoothing. */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;

  constructor(
    readonly minX: number,
    readonly minZ: number,
    maxX: number,
    maxZ: number,
    readonly cell = 0.4,
  ) {
    this.cols = Math.ceil((maxX - minX) / cell);
    this.rows = Math.ceil((maxZ - minZ) / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  private cx = (x: number) => Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
  private cz = (z: number) => Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell)));
  private center = (i: number): Pt => ({
    x: this.minX + ((i % this.cols) + 0.5) * this.cell,
    z: this.minZ + (Math.floor(i / this.cols) + 0.5) * this.cell,
  });

  private each(x0: number, z0: number, x1: number, z1: number, fn: (i: number, p: Pt) => void) {
    for (let r = this.cz(z0); r <= this.cz(z1); r++)
      for (let c = this.cx(x0); c <= this.cx(x1); c++) {
        const i = r * this.cols + c;
        fn(i, this.center(i));
      }
  }
  blockCircle(x: number, z: number, radius: number) {
    this.each(x - radius, z - radius, x + radius, z + radius, (i, p) => {
      if (Math.hypot(p.x - x, p.z - z) <= radius) this.blocked[i] = 1;
    });
  }
  blockRect(x0: number, z0: number, x1: number, z1: number) {
    this.each(x0, z0, x1, z1, (i, p) => {
      if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) this.blocked[i] = 1;
    });
  }

  isBlocked(x: number, z: number): boolean {
    if (x < this.minX || z < this.minZ) return true;
    const c = Math.floor((x - this.minX) / this.cell);
    const r = Math.floor((z - this.minZ) / this.cell);
    return c >= this.cols || r >= this.rows || this.blocked[r * this.cols + c] === 1;
  }

  /** Nearest free cell index to a point (spiral search). */
  private nearestFree(p: Pt): number {
    const c0 = this.cx(p.x), r0 = this.cz(p.z);
    for (let ring = 0; ring < Math.max(this.cols, this.rows); ring++) {
      let best = -1, bestD = Infinity;
      for (let r = r0 - ring; r <= r0 + ring; r++)
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
          const i = r * this.cols + c;
          if (this.blocked[i]) continue;
          const q = this.center(i), d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bestD) (bestD = d), (best = i);
        }
      if (best >= 0) return best;
    }
    return r0 * this.cols + c0;
  }

  /** True when the straight segment a->b stays on free cells. */
  clear(a: Pt, b: Pt): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / (this.cell * 0.4));
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      if (this.isBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  findPath(from: Pt, to: Pt): Pt[] {
    const start = this.nearestFree(from), goal = this.nearestFree(to);
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const f = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gc = goal % this.cols, gr = Math.floor(goal / this.cols);
    const h = (i: number) => Math.hypot((i % this.cols) - gc, Math.floor(i / this.cols) - gr);
    const open: number[] = [start];
    g[start] = 0;
    f[start] = h(start);

    while (open.length) {
      // The grid is ~1.5k cells, so a linear scan for the best node is plenty fast.
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      if (cur === goal) break;
      open[bi] = open[open.length - 1];
      open.pop();
      closed[cur] = 1;
      const c = cur % this.cols, r = Math.floor(cur / this.cols);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const ni = nr * this.cols + nc;
          if (this.blocked[ni] || closed[ni]) continue;
          if (dr && dc && (this.blocked[r * this.cols + nc] || this.blocked[nr * this.cols + c])) continue;
          const ng = g[cur] + (dr && dc ? Math.SQRT2 : 1);
          if (ng < g[ni]) {
            if (g[ni] === Infinity) open.push(ni);
            g[ni] = ng;
            f[ni] = ng + h(ni);
            came[ni] = cur;
          }
        }
    }
    if (came[goal] < 0 && goal !== start) return [to]; // unreachable: walk straight (should not happen)

    const cells: Pt[] = [];
    for (let i = goal; i >= 0; i = came[i]) cells.push(this.center(i));
    cells.reverse();
    cells[0] = from;

    // String-pulling: keep only the corners that are needed.
    const out: Pt[] = [];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let next = cells.length - 1;
      while (next > anchor + 1 && !this.clear(cells[anchor], cells[next])) next--;
      out.push(cells[next]);
      anchor = next;
    }
    if (this.clear(out[out.length - 1] ?? from, to)) out.push(to);
    return out;
  }
}

/** Navigation grid of the hall with all furniture marked as obstacles. */
export function createHallNav(): NavGrid {
  const m = 0.45; // keep people away from the walls
  const nav = new NavGrid(-HALL.w / 2 + m, -HALL.d / 2 + m, HALL.w / 2 - m, HALL.d / 2 - m);
  for (const t of TABLES) nav.blockCircle(t.x, t.z, TABLE_CLEARANCE);
  nav.blockRect(BAR.x0 - 0.3, BAR.stoolZ - 0.35, BAR.x1 + 0.3, HALL.d / 2);
  nav.blockCircle(HOST_STAND.x, HOST_STAND.z, 0.6);
  for (const p of PLANTS) nav.blockCircle(p.x, p.z, 0.5);
  return nav;
}
