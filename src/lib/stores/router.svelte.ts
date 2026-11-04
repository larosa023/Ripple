// Tiny hash router: #/home, #/discover, #/search?q=, #/detail/movie/tt123, ...

export type RouteName = 'home' | 'discover' | 'search' | 'detail' | 'library' | 'calendar' | 'addons' | 'settings';

export interface Route {
  name: RouteName;
  params: string[];
  query: URLSearchParams;
}

const NAMES: RouteName[] = ['home', 'discover', 'search', 'detail', 'library', 'calendar', 'addons', 'settings'];

function parse(hash: string): Route {
  const [path, qs = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const name = (NAMES.includes(parts[0] as RouteName) ? parts[0] : 'home') as RouteName;
  return { name, params: parts.slice(1), query: new URLSearchParams(qs) };
}

export const router: { route: Route } = $state({ route: parse(location.hash) });

// ---------- scroll memory ----------
// Going Back (or Forward) returns you to where you were on the page, including how far each
// row was scrolled. Clicking a link to a page starts it at the top as usual.

interface Saved {
  y: number;
  rows: number[];
}
const saved = new Map<string, Saved>();
let currentKey = location.hash;
let traversing = false;

type NavEvent = Event & { navigationType?: string };
const nav = (window as Window & { navigation?: EventTarget }).navigation;
nav?.addEventListener('navigate', (e) => (traversing = (e as NavEvent).navigationType === 'traverse'));

function scrollerEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.view .detail .scroll, .view .page');
}

function remember(key: string) {
  const el = scrollerEl();
  if (!el) return;
  const rows = [...el.querySelectorAll<HTMLElement>('.scroller')].map((r) => r.scrollLeft);
  saved.delete(key);
  saved.set(key, { y: el.scrollTop, rows });
  if (saved.size > 60) saved.delete(saved.keys().next().value!);
}

/** Restores a remembered position once the page has rendered enough content (rows load async). */
let restoreRun = 0;
function restore(key: string) {
  const pos = saved.get(key);
  if (!pos) return;
  const run = ++restoreRun;
  const until = performance.now() + 2500;
  // Stop as soon as the user scrolls or goes somewhere else.
  const stop = () => run === restoreRun && restoreRun++;
  window.addEventListener('wheel', stop, { once: true, capture: true, passive: true });
  window.addEventListener('pointerdown', stop, { once: true, capture: true });
  window.addEventListener('keydown', stop, { once: true, capture: true });
  const step = () => {
    if (run !== restoreRun || currentKey !== key) return;
    const el = scrollerEl();
    if (el) {
      const rows = el.querySelectorAll<HTMLElement>('.scroller');
      pos.rows.forEach((x, i) => {
        if (rows[i] && x && rows[i].scrollLeft !== x) rows[i].scrollLeft = x;
      });
      el.scrollTop = pos.y;
      const done = Math.abs(el.scrollTop - pos.y) < 2 && rows.length >= pos.rows.length;
      if (done) return;
    }
    if (performance.now() < until) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

window.addEventListener('hashchange', () => {
  restoreRun++; // cancel any restore still running for the previous page
  remember(currentKey);
  currentKey = location.hash;
  router.route = parse(location.hash);
  if (traversing || !nav) restore(currentKey);
  traversing = false;
});

// Mouse back/forward buttons. Handled here (and the browser default cancelled) so it happens
// exactly once and the player can treat Back as "close".
window.addEventListener('mouseup', (e) => {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();
  const handled = window.dispatchEvent(new CustomEvent('ripple:mouse-nav', { cancelable: true, detail: e.button === 3 ? 'back' : 'forward' }));
  if (!handled) return; // the player used it
  if (e.button === 3) history.back();
  else history.forward();
});

export function href(name: RouteName, ...params: string[]): string {
  return '#/' + [name, ...params.map(encodeURIComponent)].join('/');
}

export function go(name: RouteName, params: string[] = [], query?: Record<string, string>, replace = false) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const hash = href(name, ...params) + qs;
  // replace: update the address without adding a Back step (e.g. while typing a search).
  if (replace) location.replace(hash);
  else location.hash = hash.slice(1);
}

export function back() {
  history.length > 1 ? history.back() : go('home');
}
