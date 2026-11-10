import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import './styles/tokens.css';
import './styles/ui.css';

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Engine, type Quality } from './core/engine';
import { Views } from './core/views';
import { TIMING, seatsOf, tableById, type Pt } from './data/config';
import { RestaurantSim } from './sim/restaurantSim';
import { DayNight } from './world/dayNight';
import { buildExterior } from './world/exterior';
import { FoodLayer, buildCandleLight, buildFurniture, type PickData } from './world/furniture';
import { HallLights } from './world/lighting';
import { People } from './world/people';
import { buildRoom } from './world/room';
import { ambience, initPlayer, isMuted, music, setMuted, sfx, unlockAudio } from './ui/audio';
import { initMenu } from './ui/menu';
import { initPullCord } from './ui/pullCord';
import { TableLabels } from './ui/tableLabels';
import { initTimeDial } from './ui/timeDial';
import { $, toast } from './ui/toasts';
import { initViewSwitcher } from './ui/viewSwitcher';

const SPEEDS = [1, 4, 12];
/** The simulation advances in fixed steps, independent of the frame rate. */
const SIM_STEP = 1 / 60;
const MAX_STEPS = 16; // per frame: enough for 12x at 45 fps, and no "spiral of death" after a hitch
const params = new URLSearchParams(location.search);

function progress(fraction: number) {
  $('loader-fill').style.width = `${Math.round(fraction * 100)}%`;
  $('loader').setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
}

async function boot() {
  const engine = new Engine($('app'));
  const { scene, camera, renderer } = engine;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  // The menu-card texture is drawn with the brand fonts, so make sure they are ready.
  await Promise.all([document.fonts.load('600 40px "Cormorant Garamond"'), document.fonts.load('500 22px Inter')]).catch(() => undefined);
  progress(0.15);

  // ----- world
  const furniture = buildFurniture();
  const candle = buildCandleLight(furniture.flames);
  const exterior = buildExterior();
  const lights = new HallLights(candle);
  const food = new FoodLayer();
  const people = new People();
  scene.add(buildRoom(), furniture.group, candle.flames, candle.pools, exterior.group, lights.group, food.group, people.group);
  const dayNight = new DayNight(engine, exterior);
  progress(0.35);
  await people.load((f) => progress(0.35 + f * 0.5));

  // ----- simulation + UI
  const sim = new RestaurantSim();
  let speed = TIMING.timeSpeed;
  let simDebt = 0;
  const setSpeed = (s: number) => {
    speed = s;
    $('speed-text').textContent = `${s}×`;
  };
  const views = new Views(engine);
  views.people = () => sim.agents.values();
  views.onStep = sfx.step;
  views.onLand = sfx.land;
  const menu = initMenu((tableId, dishes) => sim.placeOrder(tableId, dishes));
  const switcher = initViewSwitcher(views, sim, menu.open);
  const pointer = { x: innerWidth / 2, y: innerHeight / 2, inside: false };
  const labels = new TableLabels(sim, furniture.glows, views, (id) => switcher.openPopup(id, pointer.x, pointer.y));
  scene.add(labels.group);
  const updateDial = initTimeDial(dayNight);
  const toggleLights = () => lights.set(!lights.on);
  const updateCord = initPullCord(() => lights.on, toggleLights);
  initPlayer();

  const mine = new Set<number>(); // tables booked by the visitor (for toasts)
  const book = sim.book.bind(sim);
  sim.book = (id, size) => {
    const ok = book(id, size);
    if (ok && size !== undefined) mine.add(id);
    return ok;
  };
  sim.on((e) => {
    if (e.type === 'food') toast(`Order served · Table ${e.tableId}`);
    if (e.type === 'state' && mine.has(e.tableId)) {
      if (e.state === 'SEATED') toast(`Your guests are seated at table ${e.tableId}.`);
      if (e.state === 'SERVED') toast(`A waiter is now serving table ${e.tableId}.`);
      if (e.state === 'FREE') mine.delete(e.tableId);
    }
  });

  // ----- audio: starts on the first gesture (autoplay policy)
  addEventListener('pointerdown', unlockAudio, { capture: true });
  addEventListener('keydown', unlockAudio, { capture: true });
  $('ui').addEventListener('click', (e) => (e.target as HTMLElement).closest('button') && sfx.ui());
  const mute = (on = !isMuted()) => {
    setMuted(on);
    $('btn-sound').setAttribute('aria-pressed', String(!on));
  };

  // ----- top bar
  $('btn-labels').addEventListener('click', (e) => {
    labels.mode = labels.mode === 'always' ? 'hover' : 'always';
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(labels.mode === 'always'));
    toast(labels.mode === 'always' ? 'Table labels: always visible' : 'Table labels: on hover');
  });
  $('btn-sound').addEventListener('click', () => mute());
  $('btn-speed').addEventListener('click', () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]));

  // ----- global keys (walk mode adds W A S D / Space / Shift / C in Views)
  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || menu.isOpen) return;
    if ((e.target as HTMLElement).closest?.('input, [role="slider"]')) return;
    if (e.code === 'KeyL') (toggleLights(), sfx.cord());
    else if (e.code === 'KeyT') dayNight.setTime(dayNight.targetHours + (e.shiftKey ? -0.5 : 0.5));
    else if (e.code === 'KeyM') mute();
    else if (e.code === 'KeyN') music.next();
    else if (e.code === 'KeyP') music.toggle();
    else if (/^Digit[123]$/.test(e.code)) setSpeed(SPEEDS[Number(e.code[5]) - 1]);
  });

  // ----- touch joystick for walk mode
  const stick = $('stick'), knob = $('stick-knob'), jump = $('walk-jump');
  const touch = matchMedia('(pointer: coarse)').matches;
  views.onChange(() => (stick.hidden = jump.hidden = !(touch && views.mode === 'walk')));
  const steer = (e: PointerEvent | null) => {
    if (!e) return void ((views.stick.x = views.stick.y = 0), (knob.style.transform = ''));
    const r = stick.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    const len = Math.hypot(x, y) * 2;
    if (len > 1) (x /= len), (y /= len);
    views.stick.x = x * 2;
    views.stick.y = -y * 2;
    knob.style.transform = `translate(${x * 68}px, ${y * 68}px)`;
  };
  stick.addEventListener('pointerdown', (e) => (stick.setPointerCapture(e.pointerId), steer(e)));
  stick.addEventListener('pointermove', (e) => stick.hasPointerCapture(e.pointerId) && steer(e));
  stick.addEventListener('pointerup', () => steer(null));
  stick.addEventListener('pointercancel', () => steer(null));

  // ----- picking: tables, chairs and menu cards
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (): PickData | null => {
    // With the mouse captured (walk mode) the cursor is the centre of the screen.
    if (views.locked) ndc.set(0, 0);
    else ndc.set((pointer.x / innerWidth) * 2 - 1, -(pointer.y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(furniture.picks, false)[0];
    return hit ? (hit.object.userData as PickData) : null;
  };
  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', (e) => ((pointer.x = e.clientX), (pointer.y = e.clientY), (pointer.inside = true)));
  canvas.addEventListener('pointerleave', () => (pointer.inside = false));
  canvas.addEventListener('pointerdown', () => switcher.closePopup());
  canvas.addEventListener('click', (e) => {
    if (views.dragged) return;
    if (views.mode === 'walk' && !views.locked && !touch) return void views.enterWalk(); // click to capture the mouse again
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    const hit = pick();
    if (!hit || (views.mode === 'walk' && raycaster.intersectObjects(furniture.picks, false)[0].distance > 3.5)) return;
    if (views.locked) document.exitPointerLock();
    if (hit.kind === 'seat') switcher.sit(hit.tableId, hit.seat!);
    else if (hit.kind === 'menu') menu.open(hit.tableId);
    else switcher.openPopup(hit.tableId, e.clientX, e.clientY);
  });

  // ----- frame loop
  let frame = 0;
  const occupied: Pt[] = [];
  const ear = { x: 0, z: 0, yaw: 0 };
  const look = new THREE.Vector3();
  engine.onFrame((dt, t) => {
    // Fixed-step simulation: more steps at 4x / 12x, the same rendering cost at every speed.
    simDebt = Math.min(simDebt + dt * speed, SIM_STEP * MAX_STEPS);
    while (simDebt >= SIM_STEP) {
      sim.update(SIM_STEP);
      simDebt -= SIM_STEP;
    }
    people.hiddenSeat = views.seat;
    people.update(sim.agents, dt, speed);
    food.update(dt);
    lights.update(t);
    dayNight.interiorLevel = lights.level;
    dayNight.update(dt);
    views.update(dt, t);
    // A few things do not need to run every frame.
    if (frame++ % 6 === 0) {
      const hit = pointer.inside && !menu.isOpen && views.mode !== 'walk' ? pick() : null;
      labels.hovered = hit?.tableId ?? 0;
      canvas.style.cursor = hit ? 'pointer' : '';
      occupied.length = 0;
      for (const table of sim.tables) {
        food.set(table.def.id, table.food);
        if (table.seatedAt !== null) occupied.push(table.def);
      }
      camera.getWorldDirection(look);
      ear.x = camera.position.x;
      ear.z = camera.position.z;
      ear.yaw = Math.atan2(look.x, look.z);
      ambience(dt * 6, occupied, ear);
      switcher.update();
    }
    labels.update(camera);
    updateDial();
    updateCord(dt, t);
  });

  if (import.meta.env.DEV || params.has('debug')) Object.assign(window, { lumiere: { engine, sim, views, dayNight, lights, switcher, menu, music, seatsOf, tableById } });
  if (params.has('debug')) {
    const { GUI } = await import('lil-gui');
    const gui = new GUI({ title: 'Lumière debug' });
    const state = { quality: engine.quality, autoBooking: true, fps: 0, maxFrameMs: 0, drawCalls: 0 };
    renderer.info.autoReset = false;
    engine.onFrame(() => {
      state.fps = Math.round(engine.fps);
      state.maxFrameMs = Math.round(engine.maxFrame);
      state.drawCalls = renderer.info.render.calls;
      renderer.info.reset();
    });
    gui.add(state, 'quality', ['low', 'medium', 'high']).onChange((q: Quality) => engine.setQuality(q));
    gui.add(state, 'autoBooking').onChange((v: boolean) => (sim.autoBooking = v));
    gui.add(dayNight, 'autoSpeed', 0.01, 1);
    gui.add(state, 'fps').listen().disable();
    gui.add(state, 'maxFrameMs').listen().disable();
    gui.add(state, 'drawCalls').listen().disable();
    gui.add({ resetMax: () => (engine.maxFrame = 0) }, 'resetMax');
  }

  // Compile every shader variant up front, so nothing hitches on the first light toggle or view change.
  await renderer.compileAsync(scene, camera).catch(() => undefined);
  progress(1);
  engine.start();
  setTimeout(() => {
    $('loader').classList.add('is-done');
    views.intro();
  }, 350);
  setTimeout(() => ($('hint').style.opacity = '0'), 14000);
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('.loader__text')!.textContent = 'This device could not start WebGL';
});
