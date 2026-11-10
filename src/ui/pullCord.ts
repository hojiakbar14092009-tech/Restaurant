import { reducedMotion } from '../core/engine';
import { sfx } from './audio';
import { $ } from './toasts';

interface P {
  x: number;
  y: number;
  px: number;
  py: number;
}
const SEGMENTS = 16;
const GRAVITY = 2400; // px/s^2
const DAMPING = 0.986;
const STEP = 1 / 120;
const BEAD = 12;
const PULL_TO_TOGGLE = 26; // px of stretch beyond the rest length

/**
 * Vintage pull-chain light switch: a Verlet rope hanging from the top-right corner.
 * Pull the bead down past the threshold to toggle; release and it springs back and swings.
 */
export function initPullCord(isOn: () => boolean, toggle: () => void) {
  const canvas = $<HTMLCanvasElement>('cord'), bead = $<HTMLButtonElement>('cord-bead');
  const ctx = canvas.getContext('2d')!;
  let w = 0, h = 0, restLen = 0, seg = 0;
  // Cached canvas position: reading layout every frame would force a reflow.
  let left = 0, top = 0;
  const anchor = { x: 0, y: -6 };
  const pts: P[] = [];
  let grab: { x: number; y: number; startX: number; startY: number; toggled: boolean } | null = null;
  let tug = 0; // seconds left of a programmatic pull (keyboard / tap)
  let acc = 0;
  let still = reducedMotion();

  const layout = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    w = r.width;
    h = r.height;
    left = r.left;
    top = r.top;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    anchor.x = w - 46;
    restLen = Math.min(132, h * 0.3);
    seg = restLen / SEGMENTS;
    pts.length = 0;
    for (let i = 0; i <= SEGMENTS; i++) pts.push({ x: anchor.x, y: anchor.y + i * seg, px: anchor.x, py: anchor.y + i * seg });
  };
  layout();
  addEventListener('resize', layout);

  const fire = () => {
    toggle();
    sfx.cord();
    navigator.vibrate?.(12);
    const on = isOn();
    bead.setAttribute('aria-pressed', String(on));
    bead.setAttribute('aria-label', `Hall lights. Pull the cord, or press Enter, to switch them ${on ? 'off' : 'on'}`);
  };
  const local = (e: PointerEvent) => ({ x: e.clientX - left, y: e.clientY - top });

  bead.addEventListener('pointerdown', (e) => {
    bead.setPointerCapture(e.pointerId);
    const p = local(e);
    grab = { ...p, startX: p.x, startY: p.y, toggled: false };
  });
  bead.addEventListener('pointermove', (e) => {
    if (grab) Object.assign(grab, local(e));
  });
  const release = () => {
    if (!grab) return;
    const tap = Math.hypot(grab.x - grab.startX, grab.y - grab.startY) < 5;
    if (tap && !grab.toggled) pulse();
    grab = null;
  };
  bead.addEventListener('pointerup', release);
  bead.addEventListener('pointercancel', release);
  bead.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pulse();
  });
  /** Keyboard / tap fallback: a short automatic tug, then the toggle. */
  function pulse() {
    if (!reducedMotion()) tug = 0.16;
    fire();
  }

  // The cord reacts when the pointer brushes past it.
  addEventListener('pointermove', (e) => {
    if (grab || reducedMotion()) return;
    const p = local(e);
    if (p.x < 0 || p.y > h) return;
    for (let i = 3; i < pts.length; i++) {
      const q = pts[i];
      if (Math.hypot(q.x - p.x, q.y - p.y) < 18) {
        q.x += Math.max(-7, Math.min(7, e.movementX)) * 0.4;
        q.y += Math.max(-4, Math.min(4, e.movementY)) * 0.2;
      }
    }
  });

  function simulate(dt: number, t: number) {
    const end = pts[SEGMENTS];
    const breeze = still ? 0 : 0.9;
    for (let i = 1; i <= SEGMENTS; i++) {
      const p = pts[i];
      // Clamp the speed so a released stretch bounces instead of whipping to the ceiling.
      const vx = Math.max(-7, Math.min(7, (p.x - p.px) * DAMPING)), vy = Math.max(-7, Math.min(7, (p.y - p.py) * DAMPING));
      p.px = p.x;
      p.py = p.y;
      p.x += vx + Math.sin(t * 0.9 + i * 0.35) * breeze * dt * (i / SEGMENTS); // faint idle draught
      p.y += vy + GRAVITY * dt * dt;
    }
    let pinEnd = false;
    if (grab) {
      // The hand holds the bead; pulling beyond the rest length meets spring resistance.
      const dx = grab.x - anchor.x, dy = grab.y - anchor.y;
      const d = Math.hypot(dx, dy) || 1;
      const stretched = d <= restLen ? d : restLen + Math.min((d - restLen) * 0.42, restLen * 0.5);
      end.x = anchor.x + (dx / d) * stretched;
      end.y = anchor.y + (dy / d) * stretched;
      pinEnd = true;
      if (!grab.toggled && stretched - restLen > PULL_TO_TOGGLE && dy > 0) {
        grab.toggled = true;
        fire();
      }
    } else if (tug > 0) {
      tug -= dt;
      end.y += 4.5;
    }
    for (let k = 0; k < 10; k++) {
      pts[0].x = anchor.x;
      pts[0].y = anchor.y;
      for (let i = 0; i < SEGMENTS; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - seg) / d;
        const aFixed = i === 0, bFixed = pinEnd && i + 1 === SEGMENTS;
        const wa = aFixed ? 0 : bFixed ? 1 : 0.5, wb = bFixed ? 0 : aFixed ? 1 : 0.5;
        a.x += dx * diff * wa;
        a.y += dy * diff * wa;
        b.x -= dx * diff * wb;
        b.y -= dy * diff * wb;
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const end = pts[SEGMENTS];
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < SEGMENTS; i++) ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
      ctx.lineTo(end.x, end.y);
    };
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.strokeStyle = '#6e5633';
    ctx.lineWidth = 3;
    path();
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.setLineDash([2.5, 4]); // twisted-cord highlight
    ctx.strokeStyle = '#d4b07a';
    ctx.lineWidth = 1.2;
    path();
    ctx.stroke();
    ctx.setLineDash([]);

    // Ceiling mount.
    ctx.fillStyle = '#8a6c40';
    ctx.beginPath();
    ctx.roundRect(anchor.x - 9, -2, 18, 7, 3);
    ctx.fill();

    // Tassel and bead.
    const dx = end.x - pts[SEGMENTS - 1].x, dy = end.y - pts[SEGMENTS - 1].y;
    const a = Math.atan2(dy, dx) - Math.PI / 2;
    ctx.save();
    ctx.translate(end.x, end.y);
    ctx.rotate(a);
    ctx.strokeStyle = '#8a6c40';
    ctx.lineWidth = 1.4;
    for (const o of [-3, 0, 3]) {
      ctx.beginPath();
      ctx.moveTo(o * 0.6, BEAD - 2);
      ctx.lineTo(o, BEAD + 11);
      ctx.stroke();
    }
    const on = isOn();
    ctx.shadowColor = on ? 'rgba(255,196,120,0.75)' : 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = on ? 16 : 8;
    const g = ctx.createRadialGradient(-4, -4, 1, 0, 0, BEAD);
    g.addColorStop(0, '#f1dcb4');
    g.addColorStop(0.45, '#b8925a');
    g.addColorStop(1, '#5e4526');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, BEAD, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(20,17,15,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, BEAD, 3.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // The real (focusable) button follows the bead.
    bead.style.transform = `translate(${(left + end.x).toFixed(1)}px, ${(top + end.y).toFixed(1)}px)`;
  }

  return (dt: number, t: number) => {
    still = reducedMotion();
    acc = Math.min(acc + dt, 0.05);
    while (acc >= STEP) {
      simulate(STEP, t);
      acc -= STEP;
    }
    draw();
  };
}
