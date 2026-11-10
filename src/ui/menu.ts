import { MENU, findItem, formatPrice, type MenuItem } from '../data/menu';
import { duckMusic, sfx } from './audio';
import { $, toast } from './toasts';

const IMG = `${import.meta.env.BASE_URL}assets/menu/`;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};

function stepper(value: number, min: number, label: string, onChange: (v: number) => void) {
  const wrap = h('div', 'stepper');
  const minus = h('button', '', '−'), out = h('output', '', String(value)), plus = h('button', '', '+');
  minus.setAttribute('aria-label', `Less ${label}`);
  plus.setAttribute('aria-label', `More ${label}`);
  const set = (v: number) => {
    value = Math.max(min, Math.min(20, v));
    out.textContent = String(value);
    onChange(value);
  };
  minus.addEventListener('click', () => set(value - 1));
  plus.addEventListener('click', () => set(value + 1));
  wrap.append(minus, out, plus);
  return wrap;
}

/** The table menu: category tabs, item cards, and an order drawer (bottom sheet on phones). */
export function initMenu(placeOrder: (tableId: number, dishes: number) => void) {
  const dialog = $<HTMLDialogElement>('menu'), tabs = $('menu-tabs'), grid = $('menu-grid');
  const list = $('order-list'), order = $('order'), toggle = $('order-toggle'), place = $<HTMLButtonElement>('order-place');
  const carts = new Map<number, Map<string, number>>(); // one order per table
  let tableId = 1;
  let category = MENU[0].id;
  const cart = () => carts.get(tableId) ?? carts.set(tableId, new Map()).get(tableId)!;

  function card(item: MenuItem) {
    const el = h('article', 'card');
    const pic = h('div', 'card__img');
    const img = h('img');
    img.src = IMG + item.image;
    img.alt = item.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 800;
    img.height = 600;
    pic.append(img);
    if (item.tag) pic.append(h('span', 'card__tag', item.tag));
    const body = h('div', 'card__body');
    let qty = 1;
    const buy = h('div', 'card__buy');
    const add = h('button', 'btn', 'Add to order');
    add.addEventListener('click', () => {
      cart().set(item.id, (cart().get(item.id) ?? 0) + qty);
      renderOrder();
      add.textContent = 'Added ✓';
      setTimeout(() => (add.textContent = 'Add to order'), 1100);
    });
    buy.append(stepper(1, 1, item.name, (v) => (qty = v)), add);
    body.append(h('h3', 'card__name', item.name), h('p', 'card__desc', item.description), h('span', 'card__price', formatPrice(item.price)), buy);
    el.append(pic, body);
    return el;
  }

  function renderGrid() {
    const cat = MENU.find((c) => c.id === category)!;
    grid.replaceChildren(...cat.items.map(card));
    grid.setAttribute('aria-labelledby', `tab-${cat.id}`);
    grid.scrollTop = 0;
    for (const tab of tabs.children) {
      const selected = tab.id === `tab-${category}`;
      tab.setAttribute('aria-selected', String(selected));
      (tab as HTMLElement).tabIndex = selected ? 0 : -1;
    }
  }

  function renderOrder() {
    const entries = [...cart()].map(([id, qty]) => ({ item: findItem(id)!, qty }));
    const count = entries.reduce((s, e) => s + e.qty, 0);
    const total = entries.reduce((s, e) => s + e.qty * e.item.price, 0);
    list.replaceChildren(
      ...(entries.length
        ? entries.map(({ item, qty }) => {
            const li = h('li');
            li.append(
              h('span', '', item.name),
              stepper(qty, 0, item.name, (v) => {
                if (v) cart().set(item.id, v);
                else cart().delete(item.id);
                renderOrder();
              }),
              h('span', 'card__price', formatPrice(item.price * qty)),
            );
            return li;
          })
        : [h('li', 'order__empty', 'Nothing here yet. Add a dish to begin.')]),
    );
    $('order-count').textContent = `${count} item${count === 1 ? '' : 's'}`;
    $('order-total').textContent = formatPrice(total);
    place.disabled = !count;
  }

  MENU.forEach((c) => {
    const tab = h('button', '', c.title);
    tab.id = `tab-${c.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'menu-grid');
    tab.addEventListener('click', () => {
      category = c.id;
      renderGrid();
    });
    tabs.append(tab);
  });
  // Arrow keys move between tabs (roving tabindex).
  tabs.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const i = MENU.findIndex((c) => c.id === category);
    category = MENU[(i + dir + MENU.length) % MENU.length].id;
    renderGrid();
    (tabs.querySelector('[aria-selected="true"]') as HTMLElement).focus();
  });

  toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', String(order.classList.toggle('is-open'))));
  $('menu-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => (duckMusic(false), sfx.menu(false)));
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close()); // click on the backdrop
  place.addEventListener('click', () => {
    const dishes = [...cart().values()].reduce((s, q) => s + q, 0);
    placeOrder(tableId, dishes);
    toast(`Order sent to the kitchen · Table ${tableId}`);
    cart().clear();
    renderOrder();
    dialog.close();
  });

  return {
    open(id: number) {
      tableId = id;
      $('menu-table').textContent = `Table ${id}`;
      renderGrid();
      renderOrder();
      if (dialog.open) return;
      dialog.showModal();
      duckMusic(true);
      sfx.menu(true);
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
