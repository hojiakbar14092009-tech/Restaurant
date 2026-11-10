// All sound: synthesised SFX (no sample files, so nothing to license or download), a quiet room ambience,
// and the streamed three-track music playlist. One shared AudioContext, created on the first user gesture.
import { $ } from './toasts';

type Bus = 'music' | 'sfx' | 'ambience';
const TRACKS = ['1.mp3', '2.mp3', '3.mp3'].map((f) => `${import.meta.env.BASE_URL}assets/audio/music/${f}`);
const CROSSFADE = 2.5;
const MAX_VOICES = 10;
const STORE = 'lumiere-audio';

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<Bus, number>>;
  } catch {
    return {};
  }
})();
export const volumes: Record<Bus, number> = { music: saved.music ?? 0.45, sfx: saved.sfx ?? 0.7, ambience: saved.ambience ?? 0.4 };

let ctx: AudioContext | null = null;
let master: GainNode;
let duck: GainNode;
const buses = {} as Record<Bus, GainNode>;
let noise: AudioBuffer;
let voices = 0;
let muted = false;
let murmur: GainNode | null = null;

const applyMaster = () => ctx && master.gain.setTargetAtTime(muted || document.hidden ? 0 : 1, ctx.currentTime, 0.05);

/** Call from a user gesture (browser autoplay policy). Safe to call repeatedly. */
export function unlockAudio() {
  if (ctx) return void (ctx.state === 'suspended' && ctx.resume());
  ctx = new AudioContext();
  master = ctx.createGain();
  master.connect(ctx.destination);
  duck = ctx.createGain();
  for (const bus of ['music', 'sfx', 'ambience'] as Bus[]) {
    buses[bus] = ctx.createGain();
    buses[bus].gain.value = volumes[bus];
    buses[bus].connect(bus === 'music' ? duck : master);
  }
  duck.connect(master);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  // Restaurant murmur: band-limited noise, very low, breathing slowly.
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 420;
  band.Q.value = 0.6;
  murmur = ctx.createGain();
  murmur.gain.value = 0;
  src.connect(band).connect(murmur).connect(buses.ambience);
  src.start();
  applyMaster();
  startMusic();
}
document.addEventListener('visibilitychange', applyMaster); // silent while the tab is hidden

export function setMuted(on: boolean) {
  muted = on;
  applyMaster();
}
export const isMuted = () => muted;
export function setVolume(bus: Bus, v: number) {
  volumes[bus] = v;
  if (ctx) buses[bus].gain.setTargetAtTime(v, ctx.currentTime, 0.03);
  localStorage.setItem(STORE, JSON.stringify(volumes));
}
/** Lower the music a little, e.g. while the menu is open. */
export const duckMusic = (on: boolean) => ctx && duck.gain.setTargetAtTime(on ? 0.45 : 1, ctx.currentTime, 0.25);

// ---------- synthesised SFX ----------
interface Tone {
  type?: OscillatorType;
  freq: number;
  to?: number; // end frequency
  dur: number;
  gain: number;
  at?: number;
  pan?: number;
}
function tone({ type = 'sine', freq, to, dur, gain, at = 0, pan = 0 }: Tone, bus: Bus = 'sfx') {
  if (!ctx || voices >= MAX_VOICES) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  p.pan.value = pan;
  osc.connect(g).connect(p).connect(buses[bus]);
  voices++;
  osc.onended = () => voices--;
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
function burst(filter: BiquadFilterType, freq: number, dur: number, gain: number, bus: Bus = 'sfx') {
  if (!ctx || voices >= MAX_VOICES) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  f.type = filter;
  f.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(buses[bus]);
  voices++;
  src.onended = () => voices--;
  src.start(t, Math.random() * 0.8, dur + 0.02);
}
const vary = (v: number, amount: number) => v * (1 + (Math.random() * 2 - 1) * amount);

export const sfx = {
  /** Pull-chain: a short creak of the cord, the mechanical click, and a faint mains hum settling. */
  cord() {
    tone({ type: 'sawtooth', freq: 340, to: 210, dur: 0.07, gain: 0.05 });
    tone({ type: 'square', freq: 1900, to: 760, dur: 0.03, gain: 0.22, at: 0.07 });
    tone({ type: 'square', freq: 240, to: 96, dur: 0.09, gain: 0.35, at: 0.082 });
    tone({ freq: 100, dur: 0.7, gain: 0.03, at: 0.1 });
  },
  /** One footstep. Wood / marble is a bright tap with a low thud; the rug is a soft muffled thump. */
  step(sprint: boolean, rug: boolean) {
    const loud = sprint ? 1.35 : 1;
    if (rug) return void burst('lowpass', vary(260, 0.2), 0.11, vary(0.2, 0.2) * loud);
    burst('bandpass', vary(sprint ? 900 : 700, 0.25), 0.06, vary(0.3, 0.2) * loud);
    tone({ freq: vary(86, 0.15), to: 52, dur: 0.09, gain: vary(0.28, 0.2) * loud });
  },
  land() {
    burst('lowpass', 420, 0.16, 0.5);
    tone({ freq: 74, to: 40, dur: 0.18, gain: 0.5 });
  },
  /** Glass / cutlery clink somewhere in the room: `pan` -1..1, `near` 0..1 by distance. */
  clink(pan: number, near: number) {
    const f = vary(3100, 0.25);
    tone({ freq: f, dur: 0.28, gain: 0.05 * near, pan }, 'ambience');
    tone({ freq: f * 1.52, dur: 0.18, gain: 0.03 * near, pan, at: 0.004 }, 'ambience');
  },
  menu(open: boolean) {
    tone({ freq: open ? 520 : 660, to: open ? 780 : 440, dur: 0.14, gain: 0.07 });
  },
  ui() {
    tone({ freq: 1250, dur: 0.035, gain: 0.03 });
  },
};

let nextClink = 3;
/** Room ambience: murmur follows how full the hall is; clinks come from occupied tables near the listener. */
export function ambience(dt: number, occupied: { x: number; z: number }[], ear: { x: number; z: number; yaw: number }) {
  if (!ctx || !murmur) return;
  murmur.gain.setTargetAtTime(0.012 + 0.05 * Math.min(1, occupied.length / 8), ctx.currentTime, 1.5);
  if ((nextClink -= dt) > 0 || !occupied.length) return;
  nextClink = 1.2 + Math.random() * 4;
  const t = occupied[(Math.random() * occupied.length) | 0];
  const dx = t.x - ear.x, dz = t.z - ear.z, dist = Math.hypot(dx, dz);
  // Right of the listener is (-cos yaw, sin yaw) for a heading of (sin yaw, cos yaw).
  const pan = dist < 0.1 ? 0 : (dx * -Math.cos(ear.yaw) + dz * Math.sin(ear.yaw)) / dist;
  sfx.clink(Math.max(-1, Math.min(1, pan)), 1 / (1 + dist * dist * 0.06));
}

// ---------- music playlist (streamed, never decoded into memory) ----------
const decks: { el: HTMLAudioElement; gain: GainNode }[] = [];
let active = 0; // deck index
let track = 0;
let wantPlaying = true;

function deck(i: number) {
  if (!decks[i]) {
    const el = new Audio();
    el.preload = 'none';
    const gain = ctx!.createGain();
    gain.gain.value = 0;
    ctx!.createMediaElementSource(el).connect(gain).connect(buses.music);
    // Start the crossfade just before the current track ends.
    el.addEventListener('timeupdate', () => {
      if (decks[active]?.el !== el || !el.duration) return;
      if (el.duration - el.currentTime < CROSSFADE + 0.3) playTrack(track + 1);
    });
    decks[i] = { el, gain };
  }
  return decks[i];
}

function playTrack(index: number) {
  if (!ctx) return;
  track = (index + TRACKS.length) % TRACKS.length;
  const from = decks[active], to = deck(1 - active);
  active = 1 - active;
  const t = ctx.currentTime;
  if (from) {
    from.gain.gain.cancelScheduledValues(t);
    from.gain.gain.setValueAtTime(from.gain.gain.value, t);
    from.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE);
    setTimeout(() => decks[active].el !== from.el && from.el.pause(), CROSSFADE * 1000 + 100);
  }
  to.el.src = TRACKS[track];
  to.el.currentTime = 0;
  to.gain.gain.cancelScheduledValues(t);
  to.gain.gain.setValueAtTime(0, t);
  to.gain.gain.linearRampToValueAtTime(1, t + CROSSFADE);
  if (wantPlaying) to.el.play().catch(() => (wantPlaying = false));
  renderPlayer();
}
const startMusic = () => playTrack(0);

function togglePlay() {
  unlockAudio();
  const d = decks[active];
  if (!d) return;
  wantPlaying = d.el.paused;
  if (wantPlaying) d.el.play().catch(() => (wantPlaying = false));
  else d.el.pause();
  renderPlayer();
}
export const music = {
  toggle: togglePlay,
  next: () => (unlockAudio(), playTrack(track + 1)),
  prev: () => (unlockAudio(), playTrack(track - 1)),
  /** For tests / debugging. */
  get state() {
    const d = decks[active];
    return { track: track + 1, playing: !!d && !d.el.paused, time: d?.el.currentTime ?? 0, duration: d?.el.duration ?? 0 };
  },
};

function renderPlayer() {
  const d = decks[active];
  $('player-track').textContent = `Track ${track + 1}`;
  const playing = !!d && wantPlaying;
  $('player-play').setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
  $('player-play').dataset.playing = String(playing);
}

/** Wires the compact music player and the three volume sliders. */
export function initPlayer() {
  const panel = $('player'), fill = $('player-fill');
  $('player-toggle').addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    $('player-toggle').setAttribute('aria-expanded', String(open));
  });
  $('player-play').addEventListener('click', togglePlay);
  $('player-next').addEventListener('click', music.next);
  $('player-prev').addEventListener('click', music.prev);
  for (const bus of ['music', 'sfx', 'ambience'] as Bus[]) {
    const input = $<HTMLInputElement>(`vol-${bus}`);
    input.value = String(Math.round(volumes[bus] * 100));
    input.addEventListener('input', () => setVolume(bus, Number(input.value) / 100));
  }
  // The progress bar is cheap to update a few times per second; no per-frame DOM work.
  setInterval(() => {
    const d = decks[active];
    if (d?.el.duration) fill.style.transform = `scaleX(${(d.el.currentTime / d.el.duration).toFixed(3)})`;
  }, 500);
  renderPlayer();
}
