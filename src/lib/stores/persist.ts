const PREFIX = 'ripple:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    // Merge plain objects so newly added settings get their defaults.
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      return { ...fallback, ...parsed };
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced write so rapid changes (sliders, drag reorder) don't thrash storage. */
export function save(key: string, value: unknown) {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch {
        /* storage unavailable or full: keep running in memory */
      }
    }, 150),
  );
}

export function exportAll(): string {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)!);
  }
  return JSON.stringify({ app: 'ripple', version: 1, data: out }, null, 2);
}

export function importAll(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.app !== 'ripple' || typeof parsed.data !== 'object') throw new Error('Not a Ripple backup file.');
  for (const [k, v] of Object.entries(parsed.data)) localStorage.setItem(PREFIX + k, JSON.stringify(v));
}
