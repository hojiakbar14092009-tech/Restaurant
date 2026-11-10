export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function toast(message: string, ms = 3600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  const host = $('toasts');
  host.append(el);
  while (host.children.length > 3) host.firstElementChild!.remove();
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, ms);
}
