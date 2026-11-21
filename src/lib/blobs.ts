// Big things (whole playlists, parsed guides) go in IndexedDB rather than localStorage,
// which is small and shared with settings. Falls back to memory if IndexedDB is unavailable.

const DB = 'ripple-blobs';
const STORE = 'kv';
const memory = new Map<string, unknown>();
let dbp: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve) => {
        if (!d) return resolve(undefined);
        try {
          const req = fn(d.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function getBlob<T>(key: string): Promise<T | undefined> {
  const v = await run<T>('readonly', (s) => s.get(key));
  return v ?? (memory.get(key) as T | undefined);
}

export async function putBlob(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const ok = await run('readwrite', (s) => s.put(value, key));
  if (ok !== undefined) memory.delete(key); // stored for real; no need to hold a copy
}

export async function delBlob(key: string): Promise<void> {
  memory.delete(key);
  await run('readwrite', (s) => s.delete(key));
}

/** Deletes entries whose key starts with `prefix` and whose `at` timestamp is older than `maxAgeMs`. */
export async function pruneBlobs(prefix: string, maxAgeMs: number): Promise<void> {
  const d = await db();
  if (!d) return;
  const cutoff = Date.now() - maxAgeMs;
  try {
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const req = store.openCursor(range);
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      const v = c.value as { at?: number } | undefined;
      if (!v || typeof v.at !== 'number' || v.at < cutoff) c.delete();
      c.continue();
    };
  } catch {
    /* best effort */
  }
}
