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
/** Set while a backup is being restored, so in-memory state can't overwrite it before the reload. */
let frozen = false;
let warnedFull = false;

/** Shown once if storage is full, since settings and progress would otherwise stop saving silently. */
function warnFull() {
  if (warnedFull) return;
  warnedFull = true;
  void import('./toast.svelte').then(({ toast }) =>
    toast(
      "Ripple's storage is full, so changes aren't being saved. Remove a large background image, custom font or saved themes in Customize.",
      'error',
      15000,
    ),
  );
}

/** Debounced write so rapid changes (sliders, drag reorder) don't thrash storage. */
export function save(key: string, value: unknown) {
  if (frozen) return;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      if (frozen) return;
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {
        // Full: keep running in memory, but tell the user once.
        if ((e as DOMException)?.name === 'QuotaExceededError') warnFull();
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
  frozen = true;
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  try {
    for (const [k, v] of Object.entries(parsed.data)) localStorage.setItem(PREFIX + k, JSON.stringify(v));
  } catch (e) {
    frozen = false; // restore failed: keep saving as normal
    throw e;
  }
}
