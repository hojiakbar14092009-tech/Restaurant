import {
  POINTS, SEATS_PER_TABLE, TABLES, TIMING, WAITER_COUNT, WAITER_POSTS,
  seatsOf, waiterApproach, waiterSpot, type Pt,
} from '../data/config';
import { createAgent, stepAgent, type Agent } from './agents';
import { createHallNav, type NavGrid } from './pathfinding';
import { createTable, transition, type Table, type TableState } from './tableState';

export type SimEvent =
  | { type: 'state'; tableId: number; state: TableState }
  | { type: 'food'; tableId: number }
  | { type: 'order'; tableId: number };

interface Group {
  tableId: number;
  members: Agent[];
  phase: 'toHost' | 'atHost' | 'toTable' | 'seated' | 'leaving';
  timer: number;
}
interface Task {
  kind: 'serve' | 'deliver';
  tableId: number;
  readyAt: number;
  dishes: number;
}
interface Waiter {
  agent: Agent;
  zone: number;
  task: Task | null;
  phase: 'idle' | 'toKitchen' | 'atKitchen' | 'toTable' | 'atTable' | 'return';
  timer: number;
}

const between = (rng: () => number, [a, b]: readonly [number, number]) => a + rng() * (b - a);

/**
 * The whole restaurant as plain state: tables, guests, waiters. No rendering, no DOM.
 * Call update(dt) with (already speed-scaled) seconds; read tables/agents to draw.
 */
export class RestaurantSim {
  time = 0;
  autoBooking = true;
  readonly tables: Table[] = TABLES.map(createTable);
  readonly agents = new Map<number, Agent>();
  readonly waiters: Waiter[] = [];
  private groups: Group[] = [];
  private arrivals: { tableId: number; size: number; at: number }[] = [];
  private entering: Group | null = null;
  private tasks: Task[] = [];
  private nextAuto: number;
  private listeners: ((e: SimEvent) => void)[] = [];

  constructor(
    private rng: () => number = Math.random,
    private nav: NavGrid = createHallNav(),
  ) {
    for (let i = 0; i < WAITER_COUNT; i++) {
      const post = WAITER_POSTS[i];
      const agent = createAgent('waiter', post, i, post.yaw);
      this.agents.set(agent.id, agent);
      this.waiters.push({ agent, zone: i, task: null, phase: 'idle', timer: 0 });
    }
    this.nextAuto = between(rng, [2, 5]);
  }

  on(fn: (e: SimEvent) => void) {
    this.listeners.push(fn);
  }
  private emit(e: SimEvent) {
    for (const fn of this.listeners) fn(e);
  }
  table = (id: number): Table => this.tables[id - 1];

  private setState(t: Table, to: TableState) {
    transition(t, to, this.time);
    this.emit({ type: 'state', tableId: t.def.id, state: to });
  }

  /** Reserve a free table. The guests arrive a little later. Returns false if the table is not free. */
  book(tableId: number, size = 1 + Math.floor(this.rng() * SEATS_PER_TABLE)): boolean {
    const t = this.table(tableId);
    if (!t || t.state !== 'FREE') return false;
    this.setState(t, 'RESERVED');
    this.arrivals.push({
      tableId,
      size: Math.min(SEATS_PER_TABLE, Math.max(1, size)),
      at: this.time + between(this.rng, TIMING.arrivalDelay),
    });
    return true;
  }

  /** Send an order to the kitchen; a waiter brings the dishes to the table later. */
  placeOrder(tableId: number, dishes: number) {
    if (dishes <= 0) return;
    this.tasks.push({ kind: 'deliver', tableId, dishes, readyAt: this.time + between(this.rng, TIMING.foodDelay) });
    this.emit({ type: 'order', tableId });
  }

  update(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    this.autoBook();
    this.admitNextGroup();
    for (const g of [...this.groups]) this.updateGroup(g, dt);
    for (const t of this.tables)
      if (t.state === 'SEATED' && this.time - t.since >= TIMING.seatedFlash) {
        this.setState(t, 'WAITING_WAITER');
        this.tasks.push({ kind: 'serve', tableId: t.def.id, readyAt: 0, dishes: 0 });
      }
    this.assignTasks();
    for (const w of this.waiters) this.updateWaiter(w, dt);
  }

  private autoBook() {
    if (!this.autoBooking || this.time < this.nextAuto) return;
    this.nextAuto = this.time + between(this.rng, TIMING.autoBookEvery);
    const free = this.tables.filter((t) => t.state === 'FREE');
    if (free.length) this.book(free[Math.floor(this.rng() * free.length)].def.id);
  }

  /** Groups come in strictly one at a time, in booking order. */
  private admitNextGroup() {
    if (this.entering || !this.arrivals.length || this.arrivals[0].at > this.time) return;
    const { tableId, size } = this.arrivals.shift()!;
    const members: Agent[] = [];
    for (let i = 0; i < size; i++) {
      const a = createAgent('customer', { x: POINTS.outside.x, z: POINTS.outside.z + i * 0.7 }, Math.floor(this.rng() * 1000));
      a.path = [POINTS.door, { x: POINTS.host.x, z: POINTS.host.z + i * 0.65 }];
      a.delay = i * 0.2;
      this.agents.set(a.id, a);
      members.push(a);
    }
    const group: Group = { tableId, members, phase: 'toHost', timer: 0 };
    this.groups.push(group);
    this.entering = group;
  }

  private updateGroup(g: Group, dt: number) {
    const table = this.table(g.tableId);
    switch (g.phase) {
      case 'toHost': {
        let arrived = true;
        for (const a of g.members) arrived = stepAgent(a, dt, this.agents.values()) && arrived;
        if (arrived) (g.phase = 'atHost'), (g.timer = TIMING.hostPause);
        break;
      }
      case 'atHost':
        if ((g.timer -= dt) > 0) break;
        // Only free seats: this table is reserved for exactly this group, one seat per guest.
        seatsOf(table.def).slice(0, g.members.length).forEach((seat, i) => {
          const a = g.members[i];
          a.seat = { tableId: seat.tableId, index: seat.index };
          a.path = [...this.nav.findPath(a, seat.approach), seat];
          a.delay = i * 0.8;
        });
        g.phase = 'toTable';
        this.entering = null;
        break;
      case 'toTable': {
        const seats = seatsOf(table.def);
        let seated = true;
        for (const a of g.members) {
          if (a.sitting) continue;
          if (stepAgent(a, dt, this.agents.values())) (a.sitting = true), (a.yaw = seats[a.seat!.index].yaw);
          else seated = false;
        }
        if (seated) (g.phase = 'seated'), this.setState(table, 'SEATED');
        break;
      }
      case 'seated':
        if (table.state !== 'SERVED' || this.time < table.leaveAt) break;
        if (this.tasks.some((t) => t.kind === 'deliver' && t.tableId === g.tableId)) break; // food is on its way
        g.members.forEach((a, i) => {
          const seat = seatsOf(table.def)[a.seat!.index];
          a.sitting = false;
          a.seat = null;
          a.path = [seat.approach, ...this.nav.findPath(seat.approach, POINTS.door), POINTS.outside];
          a.delay = i * 0.8;
        });
        g.phase = 'leaving';
        break;
      case 'leaving':
        for (const a of [...g.members])
          if (stepAgent(a, dt, this.agents.values())) {
            this.agents.delete(a.id);
            g.members.splice(g.members.indexOf(a), 1);
          }
        if (!g.members.length) {
          this.groups.splice(this.groups.indexOf(g), 1);
          this.setState(table, 'FREE');
        }
        break;
    }
  }

  /** Tasks are handled in queue order; the zone's own waiter is preferred, else the nearest free one. */
  private assignTasks() {
    for (const task of [...this.tasks]) {
      if (task.readyAt > this.time) continue;
      if (this.waiters.some((w) => w.task === task)) continue;
      const def = this.table(task.tableId).def;
      const free = this.waiters.filter((w) => !w.task);
      if (!free.length) return;
      const dist = (w: Waiter) => Math.hypot(w.agent.x - def.x, w.agent.z - def.z);
      const waiter = free.find((w) => w.zone === def.zone) ?? free.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
      waiter.task = task;
      if (task.kind === 'deliver') this.send(waiter, 'toKitchen', POINTS.kitchen);
      else this.send(waiter, 'toTable', waiterApproach(def), waiterSpot(def));
    }
  }

  private send(w: Waiter, phase: Waiter['phase'], to: Pt, final?: Pt) {
    w.phase = phase;
    w.agent.path = this.nav.findPath(w.agent, to);
    if (final) w.agent.path.push(final);
  }

  private finishTask(w: Waiter) {
    this.tasks.splice(this.tasks.indexOf(w.task!), 1);
    w.task = null;
    w.agent.carrying = false;
    this.send(w, 'return', WAITER_POSTS[w.zone]);
  }

  private updateWaiter(w: Waiter, dt: number) {
    const a = w.agent;
    // Always step, so `moving` is cleared once the waiter stands still.
    const arrived = stepAgent(a, dt, this.agents.values()) && w.phase !== 'idle';
    switch (w.phase) {
      case 'toKitchen':
        if (arrived) (w.phase = 'atKitchen'), (w.timer = 1.5);
        break;
      case 'atKitchen': {
        if ((w.timer -= dt) > 0) break;
        const def = this.table(w.task!.tableId).def;
        a.carrying = true;
        this.send(w, 'toTable', waiterApproach(def), waiterSpot(def));
        break;
      }
      case 'toTable':
        if (!arrived) break;
        a.yaw = waiterSpot(this.table(w.task!.tableId).def).yaw;
        w.phase = 'atTable';
        w.timer = TIMING.serveTime;
        this.arriveAtTable(w);
        break;
      case 'atTable':
        if ((w.timer -= dt) <= 0) this.finishTask(w);
        break;
      case 'return':
        if (arrived) (w.phase = 'idle'), (a.yaw = WAITER_POSTS[w.zone].yaw);
        break;
    }
  }

  private arriveAtTable(w: Waiter) {
    const task = w.task!;
    const table = this.table(task.tableId);
    if (task.kind === 'serve') {
      if (table.state !== 'WAITING_WAITER') return;
      this.setState(table, 'SERVED');
      table.leaveAt = this.time + between(this.rng, TIMING.stay);
    } else {
      w.agent.carrying = false;
      table.food = Math.min(6, table.food + task.dishes);
      if (table.state === 'SERVED') table.leaveAt = Math.max(table.leaveAt, this.time + 60);
      this.emit({ type: 'food', tableId: task.tableId });
    }
  }
}
