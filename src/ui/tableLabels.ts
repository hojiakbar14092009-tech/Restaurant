import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import gsap from 'gsap';
import { STATUS_COLORS, TABLES } from '../data/config';
import type { RestaurantSim } from '../sim/restaurantSim';
import { formatClock, timeInRestaurant, timeWaiting, type TableState } from '../sim/tableState';
import type { TableGlow } from '../world/furniture';
import type { Views } from '../core/views';

const SEAT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v9h10V3M5 12h14v3H5zM7 15v6M17 15v6"/></svg>';

interface Label {
  obj: CSS2DObject;
  inner: HTMLElement;
  stay: HTMLElement;
  wait: HTMLElement;
  stayText: HTMLElement;
  waitText: HTMLElement;
  state: TableState | '';
  text: string;
  style: string;
}

/** Floating glass labels above the tables (status dot + both timers) and the coloured table glow. */
export class TableLabels {
  readonly group = new THREE.Group();
  mode: 'always' | 'hover' = 'always';
  hovered = 0;
  private labels: Label[] = [];

  constructor(private sim: RestaurantSim, private glows: TableGlow[], private views: Views, onSeats: (tableId: number) => void) {
    for (const t of TABLES) {
      const el = document.createElement('div');
      el.className = 'tlabel';
      el.innerHTML = `<div class="tlabel__in">
        <div class="tlabel__head"><span class="dot"></span><span>Table ${t.id}</span>
          <button aria-label="Choose a seat at table ${t.id}">${SEAT_ICON}</button></div>
        <div class="tlabel__line" hidden>In restaurant: <b></b></div>
        <div class="tlabel__line tlabel__line--wait" hidden>Waiting for waiter: <b></b></div>
      </div>`;
      el.querySelector('button')!.addEventListener('click', (e) => {
        e.stopPropagation();
        onSeats(t.id);
      });
      const [stay, wait] = el.querySelectorAll<HTMLElement>('.tlabel__line');
      const obj = new CSS2DObject(el);
      obj.position.set(t.x, 1.85, t.z);
      obj.center.set(0.5, 1);
      this.group.add(obj);
      this.labels.push({
        obj, inner: el.firstElementChild as HTMLElement, stay, wait,
        stayText: stay.querySelector('b')!, waitText: wait.querySelector('b')!, state: '', text: '', style: '',
      });
    }
  }

  private setGlow(i: number, state: TableState) {
    const g = this.glows[i];
    const on = state !== 'FREE';
    const color = new THREE.Color(STATUS_COLORS[state]);
    const rim = color.clone().multiplyScalar(2.4); // HDR so the rim blooms softly
    if (on) {
      gsap.to(g.rim.color, { r: rim.r, g: rim.g, b: rim.b, duration: 0.8, ease: 'power2.out' });
      gsap.to(g.halo.color, { r: color.r, g: color.g, b: color.b, duration: 0.8, ease: 'power2.out' });
    }
    gsap.to(g.rim, { opacity: on ? 1 : 0, duration: 0.8 });
    gsap.to(g.halo, { opacity: on ? 0.32 : 0, duration: 0.8 });
  }

  update(camera: THREE.Camera) {
    const seatTable = this.views.seat?.tableId ?? 0;
    this.sim.tables.forEach((t, i) => {
      const l = this.labels[i];
      if (t.state !== l.state) {
        l.state = t.state;
        l.obj.element.dataset.state = t.state;
        this.setGlow(i, t.state);
      }
      const stay = timeInRestaurant(t, this.sim.time), wait = timeWaiting(t, this.sim.time);
      // Whole seconds only: the label DOM is touched once per displayed second, not every frame.
      const text = `${stay === null ? '' : Math.floor(stay)}|${wait === null ? '' : Math.floor(wait)}`;
      if (text !== l.text) {
        l.text = text;
        l.stay.hidden = stay === null;
        l.wait.hidden = wait === null;
        if (stay !== null) l.stayText.textContent = formatClock(stay);
        if (wait !== null) l.waitText.textContent = formatClock(wait);
      }

      // Scale with distance, fade when the camera is close, hide for the table you are sitting at.
      const dist = camera.position.distanceTo(l.obj.position);
      const inSeat = this.views.mode === 'seat';
      let opacity = THREE.MathUtils.smoothstep(dist, 1.8, 3.2) * (1 - THREE.MathUtils.smoothstep(dist, 24, 30));
      if (inSeat && t.def.id === seatTable) opacity = 0;
      if (this.mode === 'hover' && this.hovered !== t.def.id) opacity = 0;
      const scale = THREE.MathUtils.clamp(10 / dist, 0.5, 1.05) * (inSeat ? 0.85 : 1);
      // Hidden labels are not laid out at all; visible ones only write styles that actually changed.
      const shown = opacity >= 0.02;
      l.obj.visible = shown;
      const style = shown ? `${scale.toFixed(2)}|${opacity.toFixed(1)}` : '';
      if (style === l.style) return;
      l.style = style;
      if (!shown) return;
      l.inner.style.transform = `scale(${scale.toFixed(2)})`;
      l.inner.style.opacity = opacity.toFixed(1);
    });
  }
}
