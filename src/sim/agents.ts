import { TIMING, type Pt } from '../data/config';

export type AgentKind = 'customer' | 'waiter';

/** A walking person. Pure data, advanced by stepAgent; the renderer only reads it. */
export interface Agent extends Pt {
  id: number;
  kind: AgentKind;
  /** Visual variant (model / palette), chosen by the simulation so runs are reproducible. */
  variant: number;
  yaw: number;
  path: Pt[];
  delay: number;
  moving: boolean;
  sitting: boolean;
  carrying: boolean;
  /** Seconds spent yielding to somebody in the way. */
  yielded: number;
  /** Seconds left of walking straight through a blockage (stuck recovery). */
  pushing: number;
  /** Seat the agent occupies or walks to (customers only). */
  seat: { tableId: number; index: number } | null;
}

let nextId = 1;
export const createAgent = (kind: AgentKind, at: Pt, variant: number, yaw = Math.PI): Agent => ({
  id: nextId++, kind, variant, x: at.x, z: at.z, yaw, path: [], delay: 0,
  moving: false, sitting: false, carrying: false, yielded: 0, pushing: 0, seat: null,
});

const PERSONAL_SPACE = 0.6;
const MAX_YIELD = 1.5;

/** Somebody with priority (lower id) is standing or walking right in front of us. */
function blockedBy(a: Agent, others: Iterable<Agent>, dirX: number, dirZ: number): boolean {
  for (const o of others) {
    if (o === a || o.sitting || o.id > a.id) continue;
    const dx = o.x - a.x, dz = o.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < PERSONAL_SPACE && d > 1e-4 && (dx * dirX + dz * dirZ) / d > 0.3) return true;
  }
  return false;
}

/** Advances an agent along its path. Returns true once the path is finished. */
export function stepAgent(a: Agent, dt: number, others: Iterable<Agent>): boolean {
  a.moving = false;
  if (a.delay > 0) {
    a.delay -= dt;
    return false;
  }
  let budget = TIMING.walkSpeed * dt;
  while (a.path.length && budget > 0) {
    const target = a.path[0];
    const dx = target.x - a.x, dz = target.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      a.path.shift();
      continue;
    }
    // Stuck detector: after yielding for MAX_YIELD seconds, walk on regardless for a moment.
    if (a.pushing > 0) a.pushing -= dt;
    else if (blockedBy(a, others, dx / d, dz / d)) {
      if ((a.yielded += dt) < MAX_YIELD) return false;
      a.pushing = 2.5;
      a.yielded = 0;
    }
    a.yaw = Math.atan2(dx, dz);
    a.moving = true;
    const step = Math.min(d, budget);
    a.x += (dx / d) * step;
    a.z += (dz / d) * step;
    budget -= step;
    if (step === d) a.path.shift();
  }
  return a.path.length === 0;
}
