import type { TableDef } from '../data/config';

export type TableState = 'FREE' | 'RESERVED' | 'SEATED' | 'WAITING_WAITER' | 'SERVED';

/** The only legal transitions. SERVED never goes back to yellow/red during a visit. */
const NEXT: Record<TableState, TableState> = {
  FREE: 'RESERVED',
  RESERVED: 'SEATED',
  SEATED: 'WAITING_WAITER',
  WAITING_WAITER: 'SERVED',
  SERVED: 'FREE',
};

export interface Table {
  def: TableDef;
  state: TableState;
  /** Simulation time of the last state change. */
  since: number;
  seatedAt: number | null;
  waitingSince: number | null;
  /** Total seconds the guests waited for a waiter (frozen once served). */
  waited: number;
  leaveAt: number;
  /** Number of dishes on the table (0 = none). */
  food: number;
}

export const createTable = (def: TableDef): Table => ({
  def, state: 'FREE', since: 0, seatedAt: null, waitingSince: null, waited: 0, leaveAt: Infinity, food: 0,
});

export const canTransition = (from: TableState, to: TableState) => NEXT[from] === to;

export function transition(t: Table, to: TableState, time: number): void {
  if (!canTransition(t.state, to)) throw new Error(`Table ${t.def.id}: illegal transition ${t.state} -> ${to}`);
  t.state = to;
  t.since = time;
  if (to === 'SEATED') (t.seatedAt = time), (t.food = 0);
  if (to === 'WAITING_WAITER') t.waitingSince = time;
  if (to === 'SERVED') (t.waited = time - (t.waitingSince ?? time)), (t.waitingSince = null);
  if (to === 'FREE') (t.seatedAt = null), (t.waited = 0), (t.leaveAt = Infinity), (t.food = 0);
}

/** Seconds since the guests sat down, or null when nobody is seated. */
export const timeInRestaurant = (t: Table, time: number) => (t.seatedAt === null ? null : time - t.seatedAt);
/** Seconds waiting for a waiter, only while WAITING_WAITER. */
export const timeWaiting = (t: Table, time: number) => (t.waitingSince === null ? null : time - t.waitingSince);

export const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
