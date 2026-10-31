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

window.addEventListener('hashchange', () => {
  router.route = parse(location.hash);
});

export function href(name: RouteName, ...params: string[]): string {
  return '#/' + [name, ...params.map(encodeURIComponent)].join('/');
}

export function go(name: RouteName, params: string[] = [], query?: Record<string, string>) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  location.hash = href(name, ...params).slice(1) + qs;
}

export function back() {
  history.length > 1 ? history.back() : go('home');
}
