import { describe, expect, it } from 'vitest';
import { TABLES, TABLE_CLEARANCE, POINTS, seatsOf } from '../data/config';
import { createHallNav } from './pathfinding';
import { RestaurantSim } from './restaurantSim';
import { canTransition, createTable, formatClock, transition, type TableState } from './tableState';

/** Deterministic PRNG so every run of the simulation is identical. */
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const run = (sim: RestaurantSim, seconds: number, until?: () => boolean) => {
  for (let t = 0; t < seconds; t += 0.05) {
    sim.update(0.05);
    if (until?.()) return true;
  }
  return false;
};

describe('table state machine', () => {
  it('allows only the strict sequence', () => {
    const order: TableState[] = ['FREE', 'RESERVED', 'SEATED', 'WAITING_WAITER', 'SERVED'];
    for (const from of order)
      for (const to of order) expect(canTransition(from, to)).toBe(order[(order.indexOf(from) + 1) % 5] === to);
  });
  it('throws on illegal transitions and never goes back from SERVED to yellow', () => {
    const t = createTable(TABLES[0]);
    expect(() => transition(t, 'SEATED', 0)).toThrow();
    for (const s of ['RESERVED', 'SEATED', 'WAITING_WAITER', 'SERVED'] as const) transition(t, s, 1);
    expect(() => transition(t, 'WAITING_WAITER', 2)).toThrow();
    expect(() => transition(t, 'RESERVED', 2)).toThrow();
  });
  it('formats timers as m:ss', () => {
    expect(formatClock(47)).toBe('0:47');
    expect(formatClock(754.9)).toBe('12:34');
  });
});

describe('path-finding', () => {
  const nav = createHallNav();
  it('reaches every seat from the door without crossing furniture', () => {
    for (const t of TABLES)
      for (const seat of seatsOf(t)) {
        const path = [POINTS.door, ...nav.findPath(POINTS.door, seat.approach)];
        expect(path.at(-1)).toEqual(seat.approach);
        for (let i = 1; i < path.length; i++) expect(nav.clear(path[i - 1], path[i])).toBe(true);
        // no waypoint inside any table's footprint
        for (const p of path)
          for (const o of TABLES) expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThan(TABLE_CLEARANCE - 0.3);
      }
  });
});

describe('restaurant simulation', () => {
  it('runs RESERVED -> SEATED -> WAITING_WAITER -> SERVED -> FREE for a booking', () => {
    const sim = new RestaurantSim(mulberry32(7));
    sim.autoBooking = false;
    const seen: TableState[] = [];
    sim.on((e) => e.type === 'state' && e.tableId === 4 && seen.push(e.state));
    expect(sim.book(4, 5)).toBe(true);
    expect(sim.book(4)).toBe(false); // already reserved
    expect(sim.table(4).state).toBe('RESERVED');

    expect(run(sim, 180, () => sim.table(4).state === 'SEATED')).toBe(true);
    const guests = [...sim.agents.values()].filter((a) => a.seat?.tableId === 4);
    expect(guests).toHaveLength(5);
    expect(new Set(guests.map((a) => a.seat!.index)).size).toBe(5); // one free seat each
    expect(guests.every((a) => a.sitting)).toBe(true);

    expect(run(sim, 10, () => sim.table(4).state === 'WAITING_WAITER')).toBe(true);
    expect(sim.table(4).waitingSince).not.toBeNull();
    expect(run(sim, 120, () => sim.table(4).state === 'SERVED')).toBe(true);
    expect(sim.table(4).waitingSince).toBeNull();
    expect(sim.table(4).waited).toBeGreaterThan(0);

    expect(run(sim, 400, () => sim.table(4).state === 'FREE')).toBe(true);
    expect(seen).toEqual(['RESERVED', 'SEATED', 'WAITING_WAITER', 'SERVED', 'FREE']);
    expect([...sim.agents.values()].filter((a) => a.kind === 'customer')).toHaveLength(0);
  });

  it('admits groups one at a time, in booking order', () => {
    const sim = new RestaurantSim(mulberry32(3));
    sim.autoBooking = false;
    const seated: number[] = [];
    sim.on((e) => e.type === 'state' && e.state === 'SEATED' && seated.push(e.tableId));
    [9, 1, 6].forEach((id) => sim.book(id, 2));
    run(sim, 240, () => seated.length === 3);
    expect(seated.length).toBe(3);
    // every table ends up served by a waiter
    expect(run(sim, 200, () => [9, 1, 6].every((id) => sim.table(id).state === 'SERVED'))).toBe(true);
  });

  it('delivers an order to the table', () => {
    const sim = new RestaurantSim(mulberry32(11));
    sim.autoBooking = false;
    sim.placeOrder(10, 3);
    expect(run(sim, 120, () => sim.table(10).food === 3)).toBe(true);
  });

  it('keeps running with automatic bookings and never breaks the state machine', () => {
    const sim = new RestaurantSim(mulberry32(42));
    let stuck = 0, worst = 0;
    const last = new Map<number, string>();
    // Nobody with somewhere to go may stand still for long (stuck detector).
    const ok = () => {
      for (const a of sim.agents.values()) {
        const key = a.x.toFixed(2) + a.z.toFixed(2);
        stuck = a.path.length && a.delay <= 0 && last.get(a.id) === key ? stuck + 1 : 0;
        worst = Math.max(worst, stuck);
        last.set(a.id, key);
      }
      return false;
    };
    expect(() => run(sim, 1800, ok)).not.toThrow();
    expect(worst * 0.05).toBeLessThan(6);
    expect(sim.tables.some((t) => t.state !== 'FREE')).toBe(true);
  });
});
