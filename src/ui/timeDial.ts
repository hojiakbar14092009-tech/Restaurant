import type { DayNight } from '../world/dayNight';
import { $ } from './toasts';

const SVG = 'http://www.w3.org/2000/svg';
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>';
const MOON = '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>';

const fmt = (hours: number) => {
  const m = Math.round(hours * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Clock-style 24 h dial. Noon is at the top; dragging the hand sets the time of day. */
export function initTimeDial(dayNight: DayNight) {
  const face = $('dial'), hand = document.getElementById('dial-hand')!, ticks = document.getElementById('dial-ticks')!;
  const out = $('dial-time'), icon = document.getElementById('dial-icon')!, auto = $('btn-auto');

  for (let h = 0; h < 24; h++) {
    const a = ((h / 24) * 360 + 180) * (Math.PI / 180), major = h % 6 === 0;
    const line = document.createElementNS(SVG, 'line');
    const r0 = major ? 46 : 49;
    line.setAttribute('class', 'dial__tick');
    line.setAttribute('x1', String(Math.sin(a) * r0));
    line.setAttribute('y1', String(-Math.cos(a) * r0));
    line.setAttribute('x2', String(Math.sin(a) * 53));
    line.setAttribute('y2', String(-Math.cos(a) * 53));
    ticks.append(line);
    if (major) {
      const text = document.createElementNS(SVG, 'text');
      text.setAttribute('class', 'dial__num');
      text.setAttribute('x', String(Math.sin(a) * 38));
      text.setAttribute('y', String(-Math.cos(a) * 38));
      text.textContent = String(h).padStart(2, '0');
      ticks.append(text);
    }
  }

  const fromPointer = (e: PointerEvent) => {
    const r = face.getBoundingClientRect();
    const deg = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    return ((((deg - 180) / 360) * 24) % 24 + 24) % 24;
  };
  const set = (hours: number) => {
    setAuto(false);
    dayNight.setTime(hours);
  };
  const setAuto = (on: boolean) => {
    dayNight.auto = on;
    auto.setAttribute('aria-pressed', String(on));
  };

  face.addEventListener('pointerdown', (e) => {
    face.setPointerCapture(e.pointerId);
    set(fromPointer(e));
  });
  face.addEventListener('pointermove', (e) => face.hasPointerCapture(e.pointerId) && set(fromPointer(e)));
  face.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1 / 6, ArrowUp: 1 / 6, ArrowLeft: -1 / 6, ArrowDown: -1 / 6, PageUp: 1, PageDown: -1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    set(dayNight.targetHours + step);
  });
  auto.addEventListener('click', () => setAuto(!dayNight.auto));

  let shown = '';
  let night: boolean | null = null;
  return () => {
    // The hand follows the target immediately; the scene eases behind it.
    const h = dayNight.targetHours;
    hand.setAttribute('transform', `rotate(${(h / 24) * 360 + 180})`);
    const text = fmt(h);
    if (text !== shown) {
      shown = out.textContent = text;
      face.setAttribute('aria-valuenow', String(Math.round(h * 60) % 1440));
      face.setAttribute('aria-valuetext', text);
    }
    if (dayNight.isNight !== night) {
      night = dayNight.isNight;
      icon.innerHTML = night ? MOON : SUN;
    }
  };
}
