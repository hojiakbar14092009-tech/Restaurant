// Single source of truth for layout and timings. Pure data: used by both the simulation and the 3D world.
// World axes: +z = north (entrance wall), -z = south (window wall), +x = west, y = up. Units: metres.

export const TABLE_COUNT = 10;
export const SEATS_PER_TABLE = 5;
export const WAITER_COUNT = 5;

export const HALL = { w: 27, d: 18, h: 8 };

/** Location used for the real solar position (Tashkent). */
export const GEO = { lat: 41.3, lon: 69.3, utcOffset: 5 };
/** 'today' or a fixed 'MM-DD'. The equinox gives a balanced day: sunrise ~06:20, sunset ~18:25. */
export const SOLAR_DATE: 'today' | `${number}-${number}` = '09-22';

export const TIMING = {
  /** Simulation speed multiplier (1 = real time). Changeable from the UI. */
  timeSpeed: 1,
  autoBookEvery: [9, 20] as const, // s between automatic bookings
  arrivalDelay: [4, 9] as const, // s between booking and the group appearing at the door
  hostPause: 2, // s the group waits at the host stand
  seatedFlash: 2.5, // s of brief GREEN before the table turns YELLOW
  serveTime: 3, // s a waiter spends at the table
  stay: [110, 200] as const, // s guests stay after being served
  foodDelay: [10, 16] as const, // s the kitchen needs for an order
  walkSpeed: 1.25, // m/s
};

export interface TableDef {
  id: number; // 1-based, as shown to guests
  x: number;
  z: number;
  zone: number; // waiter zone 0..WAITER_COUNT-1
  base: number; // angle (rad) of seat 1 around the table
}
export interface Pt {
  x: number;
  z: number;
}
export interface SeatDef extends Pt {
  tableId: number;
  index: number; // 0..4 -> seat 1..5
  yaw: number; // heading (rad) that faces the table centre
  approach: Pt; // free floor point behind the chair
}

const deg = Math.PI / 180;
const T = (id: number, x: number, z: number, zone: number, base: number): TableDef => ({ id, x, z, zone, base: base * deg });

// Two rows of four and a front row of two; 5.8 m between centres leaves ~2.6 m aisles.
export const TABLES: TableDef[] = [
  T(1, -8.7, -5.4, 0, 90),
  T(2, -2.9, -5.4, 0, 54),
  T(3, 2.9, -5.4, 1, 90),
  T(4, 8.7, -5.4, 1, 126),
  T(5, -8.7, -0.6, 2, 18),
  T(6, -2.9, -0.6, 2, 90),
  T(7, 2.9, -0.6, 3, 54),
  T(8, 8.7, -0.6, 3, 90),
  T(9, -1.2, 4.1, 4, 126),
  T(10, 4.6, 4.1, 4, 90),
];

export const TABLE_RADIUS = 0.78; // 156 cm round tables
export const SEAT_RADIUS = 1.13; // chair centre distance from the table centre
export const TABLE_CLEARANCE = 1.6; // blocked radius (table + chairs) for path-finding
const APPROACH_RADIUS = 1.9;
const SEAT_STEP = 360 / SEATS_PER_TABLE;

const polar = (t: TableDef, a: number, r: number): Pt => ({ x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r });
const facing = (a: number) => Math.atan2(-Math.cos(a), -Math.sin(a));

export function seatsOf(t: TableDef): SeatDef[] {
  return Array.from({ length: SEATS_PER_TABLE }, (_, index) => {
    const a = t.base + index * SEAT_STEP * deg;
    return { ...polar(t, a, SEAT_RADIUS), tableId: t.id, index, yaw: facing(a), approach: polar(t, a, APPROACH_RADIUS) };
  });
}

/** Angle of the gap between the last and the first chair: where waiters stand and the menu card sits. */
export const serviceAngle = (t: TableDef) => t.base - (SEAT_STEP / 2) * deg;
/** Where a waiter stands: in the gap between two chairs. */
export function waiterSpot(t: TableDef): Pt & { yaw: number } {
  const a = serviceAngle(t);
  return { ...polar(t, a, TABLE_RADIUS + 0.5), yaw: facing(a) };
}
export const waiterApproach = (t: TableDef): Pt => polar(t, serviceAngle(t), APPROACH_RADIUS);

export const tableById = (id: number): TableDef => TABLES[id - 1];
export const SEAT_LABELS = ['1', '2', '3', '4', '5'];

export const POINTS = {
  outside: { x: -10, z: 11.4 },
  door: { x: -10, z: 8.1 },
  host: { x: -10, z: 6.6 },
  kitchen: { x: 12.2, z: 8.0 },
};
export const HOST_STAND = { x: -8.4, z: 7.1 };
export const BAR = { x0: 3.6, x1: 10.6, z0: 7.5, z1: 8.2, stools: [4.3, 5.5, 6.7, 7.9, 9.1, 10.2], stoolZ: 7.0 };
export const PLANTS: Pt[] = [
  { x: -12.6, z: 8.1 }, { x: 12.5, z: 1.7 }, { x: -12.6, z: -8.1 }, { x: 12.6, z: -8.1 }, { x: -6.2, z: 8.2 },
];

/** Idle posts of the waiters, one per zone. */
export const WAITER_POSTS: (Pt & { yaw: number })[] = [
  { x: -5.8, z: -8.0, yaw: 0 },
  { x: 5.8, z: -8.0, yaw: 0 },
  { x: -12.5, z: -3.0, yaw: Math.PI / 2 },
  { x: 12.5, z: -3.0, yaw: -Math.PI / 2 },
  { x: 1.7, z: 7.2, yaw: Math.PI },
];

export const STATUS_COLORS = {
  FREE: '#000000',
  RESERVED: '#C0392B',
  SEATED: '#2E9E6A',
  WAITING_WAITER: '#E0A526',
  SERVED: '#2E9E6A',
} as const;
