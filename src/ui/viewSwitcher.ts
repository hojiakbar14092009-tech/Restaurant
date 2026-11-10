import { SEATS_PER_TABLE, SEAT_LABELS, TABLES, seatsOf, tableById } from '../data/config';
import type { RestaurantSim } from '../sim/restaurantSim';
import type { TableState } from '../sim/tableState';
import type { Views } from '../core/views';
import { $, toast } from './toasts';

const STATE_TEXT: Record<TableState, string> = {
  FREE: 'Free', RESERVED: 'Reserved', SEATED: 'Guests seated', WAITING_WAITER: 'Waiting for waiter', SERVED: 'Being served',
};

/** Seat picker, seat / walk HUD and the table popup (reserve / sit / menu). */
export function initViewSwitcher(views: Views, sim: RestaurantSim, openMenu: (tableId: number) => void) {
  const picker = $('seat-picker'), grid = $('seats-grid'), seatsBtn = $('btn-seats');
  const hud = $('hud'), popup = $('popup'), hint = $('hint'), help = $('walk-help'), walkHud = $('walk-hud');
  let lastSeat = { tableId: 1, index: 0 };
  let helpTimer = 0;
  const sit = (tableId: number, index: number) => {
    closePopup();
    togglePicker(false);
    views.enterSeat(seatsOf(tableById(tableId))[index]);
  };

  // ----- seat picker: Table 1-10 x Seat 1-5
  for (const t of TABLES) {
    const row = document.createElement('div');
    row.className = 'seats__row';
    row.append(Object.assign(document.createElement('span'), { textContent: `Table ${t.id}` }));
    SEAT_LABELS.forEach((label, i) => {
      const b = Object.assign(document.createElement('button'), { className: 'chip', textContent: label });
      b.setAttribute('aria-label', `Table ${t.id}, seat ${label}`);
      b.addEventListener('click', () => sit(t.id, i));
      row.append(b);
    });
    grid.append(row);
  }
  function togglePicker(open = picker.hidden) {
    picker.hidden = !open;
    seatsBtn.setAttribute('aria-expanded', String(open));
    if (open) (closePopup(), picker.querySelector('button')!.focus());
  }
  seatsBtn.addEventListener('click', () => togglePicker());

  // ----- walk mode
  function showHelp(on: boolean, autoHide = false) {
    help.hidden = !on;
    clearTimeout(helpTimer);
    if (on && autoHide) helpTimer = window.setTimeout(() => (help.hidden = true), 9000);
  }
  const walk = () => {
    closePopup();
    togglePicker(false);
    const entering = views.mode !== 'walk';
    views.enterWalk();
    if (entering) showHelp(true, true);
  };
  /** Table nearest to the walker, if one is within reach. */
  const nearestTable = () => {
    let best = 0, bestD = 3.0;
    for (const t of TABLES) {
      const d = Math.hypot(t.x - views.feet.x, t.z - views.feet.z);
      if (d < bestD) (bestD = d), (best = t.id);
    }
    return best;
  };
  /** V: overview -> walk -> seat view -> overview. */
  const cycle = () => {
    if (views.mode === 'overview') walk();
    else if (views.mode === 'walk') sit(lastSeat.tableId, lastSeat.index);
    else views.exit();
  };
  $('btn-walk').addEventListener('click', walk);
  $('walk-exit').addEventListener('click', () => views.exit());
  $('walk-help-btn').addEventListener('click', () => showHelp(!!help.hidden));
  $('walk-jump').addEventListener('pointerdown', () => views.jump());

  // ----- seat HUD
  $('hud-prev').addEventListener('click', () => views.stepSeat(-1));
  $('hud-next').addEventListener('click', () => views.stepSeat(1));
  $('hud-exit').addEventListener('click', () => views.exit());
  $('hud-walk').addEventListener('click', walk);
  $('hud-menu').addEventListener('click', () => views.seat && openMenu(views.seat.tableId));
  $('hud-dof').addEventListener('click', (e) => {
    views.setDof(!views.dofEnabled);
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(views.dofEnabled));
  });
  views.onChange(() => {
    const seat = views.seat;
    hud.hidden = !seat;
    walkHud.hidden = views.mode !== 'walk';
    if (views.mode !== 'walk') showHelp(false);
    document.body.dataset.view = views.mode;
    $('btn-walk').setAttribute('aria-pressed', String(views.mode === 'walk'));
    hint.style.opacity = '0';
    if (seat) {
      lastSeat = { tableId: seat.tableId, index: seat.index };
      $('hud-table').textContent = `Table ${seat.tableId}`;
      $('hud-seat').textContent = `Seat ${SEAT_LABELS[seat.index]}`;
    }
  });

  addEventListener('keydown', (e) => {
    if ($<HTMLDialogElement>('menu').open) return;
    const el = e.target as HTMLElement;
    if (el.closest?.('input, [role="slider"], [role="tablist"]')) return;
    if (e.key === 'Escape') {
      if (!popup.hidden) closePopup();
      else if (!picker.hidden) togglePicker(false);
      else views.exit();
      return;
    }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyV') cycle();
    if (e.code === 'KeyH' && views.mode === 'walk') showHelp(!!help.hidden);
    if (views.mode === 'walk' && e.code === 'KeyE') {
      const id = nearestTable();
      if (!id) return void toast('Walk up to a table and press E');
      if (views.locked) document.exitPointerLock();
      openPopup(id, innerWidth / 2 - 150, innerHeight / 2);
    }
    if (views.mode === 'seat') {
      if (e.key === 'ArrowLeft') views.stepSeat(-1);
      if (e.key === 'ArrowRight') views.stepSeat(1);
      if (e.code === 'KeyE') openMenu(views.seat!.tableId);
    }
  });

  // ----- table popup
  let popupTable = 0;
  let lastState = '';
  function closePopup() {
    popup.hidden = true;
    popupTable = 0;
  }
  function renderPopup() {
    const t = sim.table(popupTable);
    lastState = t.state;
    const id = t.def.id;
    popup.dataset.state = t.state;
    popup.innerHTML = `
      <span class="popup__status"><span class="dot"></span>${STATE_TEXT[t.state]}</span>
      <h2 class="panel__title" id="popup-title" style="margin:6px 0 0">Table ${id}</h2>
      ${t.state === 'FREE' ? `<div class="popup__reserve">
        <p>Reserve table ${id} · ${SEATS_PER_TABLE} seats</p>
        <div class="popup__row" style="margin:0;padding:0;border:0"><span>Guests</span>
          <div class="stepper"><button data-g="-1" aria-label="Fewer guests">−</button><output id="popup-guests">3</output><button data-g="1" aria-label="More guests">+</button></div></div>
        <div class="popup__actions"><button class="btn" id="popup-confirm">Confirm</button><button class="chip" id="popup-cancel">Cancel</button></div>
      </div>` : ''}
      <div class="popup__row"><span>Sit at seat</span><span class="popup__seats">${SEAT_LABELS.map((l, i) => `<button class="chip" data-seat="${i}" aria-label="Sit at seat ${l}">${l}</button>`).join('')}</span></div>
      <div class="popup__row"><span>Table menu</span><button class="chip chip--brass" id="popup-menu">Open menu</button></div>`;
  }
  popup.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('button');
    if (!el) return;
    const id = popupTable;
    if (el.dataset.g) {
      const out = $('popup-guests');
      out.textContent = String(Math.max(1, Math.min(SEATS_PER_TABLE, Number(out.textContent) + Number(el.dataset.g))));
    } else if (el.dataset.seat) sit(id, Number(el.dataset.seat));
    else if (el.id === 'popup-menu') (closePopup(), openMenu(id));
    else if (el.id === 'popup-cancel') closePopup();
    else if (el.id === 'popup-confirm') {
      const ok = sim.book(id, Number($('popup-guests').textContent));
      toast(ok ? `Table ${id} reserved. Your guests are on their way.` : `Table ${id} is no longer free.`);
      closePopup();
    }
  });
  function openPopup(tableId: number, x: number, y: number) {
    togglePicker(false);
    popupTable = tableId;
    renderPopup();
    popup.hidden = false;
    const r = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(12, Math.min(innerWidth - r.width - 12, x + 18))}px`;
    popup.style.top = `${Math.max(12, Math.min(innerHeight - r.height - 12, y - r.height / 2))}px`;
    hint.style.opacity = '0';
    (popup.querySelector('#popup-confirm, button') as HTMLElement).focus({ preventScroll: true });
  }

  return {
    openPopup,
    closePopup,
    sit,
    walk,
    /** Keeps an open popup in sync with the simulation. */
    update() {
      if (popupTable && sim.table(popupTable).state !== lastState) renderPopup();
    },
  };
}
