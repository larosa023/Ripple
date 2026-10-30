// Uses Tauri's Rust HTTP client inside the app (no CORS limits, which many
// addons need) and falls back to the browser's fetch during `npm run dev`.

type FetchFn = typeof fetch;

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
let fetchImpl: Promise<FetchFn> | null = null;

function getFetch(): Promise<FetchFn> {
  if (!fetchImpl) {
    fetchImpl = isTauri
      ? import('@tauri-apps/plugin-http').then((m) => m.fetch as unknown as FetchFn)
      : Promise.resolve(window.fetch.bind(window));
  }
  return fetchImpl;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getJson<T>(url: string, timeoutMs = 12000, init: RequestInit = {}): Promise<T> {
  const f = await getFetch();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await f(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Timed out: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function postJson<T>(url: string, body: unknown, timeoutMs = 12000): Promise<T> {
  return getJson<T>(url, timeoutMs, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export { isTauri };
