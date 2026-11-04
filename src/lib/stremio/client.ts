import { getJson } from './http';
import type {
  CatalogDef,
  InstalledAddon,
  Manifest,
  MetaDetail,
  MetaPreview,
  ResourceDef,
  SourcedStream,
  Stream,
  Subtitle,
} from './types';

// ---------- URLs ----------

/** Accepts stremio://, bare base URLs, or full manifest URLs. */
export function normalizeManifestUrl(input: string): string {
  let url = input.trim();
  if (url.startsWith('stremio://')) url = 'https://' + url.slice('stremio://'.length);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  url = url.replace(/\/+$/, '');
  if (!url.endsWith('/manifest.json')) url += '/manifest.json';
  return url;
}

export function baseUrl(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/, '');
}

export function configureUrl(addon: InstalledAddon): string {
  return baseUrl(addon.transportUrl) + '/configure';
}

function extraString(extra?: Record<string, string | number | undefined>): string {
  if (!extra) return '';
  const parts = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? '/' + parts.join('&') : '';
}

function resourceUrl(
  addon: InstalledAddon,
  resource: string,
  type: string,
  id: string,
  extra?: Record<string, string | number | undefined>,
): string {
  return `${baseUrl(addon.transportUrl)}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${extraString(extra)}.json`;
}

// ---------- Cache (TTL + in-flight de-duplication) ----------

const cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T>;
  const value = load().catch((e) => {
    cache.delete(key); // never cache failures
    throw e;
  });
  cache.set(key, { at: Date.now(), ttl: ttlMs, value });
  return value;
}

export function clearCache() {
  cache.clear();
}

let requestTimeout = 12000;
export function setRequestTimeout(ms: number) {
  requestTimeout = ms;
}

// ---------- Capability checks ----------

function resourceDef(manifest: Manifest, name: string): ResourceDef | null {
  for (const r of manifest.resources ?? []) {
    if (typeof r === 'string' && r === name) return { name };
    if (typeof r === 'object' && r.name === name) return r;
  }
  return null;
}

export function supports(addon: InstalledAddon, resource: string, type: string, id?: string): boolean {
  const def = resourceDef(addon.manifest, resource);
  if (!def) return false;
  const types = def.types ?? addon.manifest.types ?? [];
  if (!types.includes(type)) return false;
  const prefixes = def.idPrefixes ?? addon.manifest.idPrefixes;
  if (id && prefixes && prefixes.length) return prefixes.some((p) => id.startsWith(p));
  return true;
}

export function catalogExtras(c: CatalogDef): { name: string; isRequired: boolean; options?: string[] }[] {
  if (c.extra) return c.extra.map((e) => ({ name: e.name, isRequired: !!e.isRequired, options: e.options }));
  const req = new Set(c.extraRequired ?? []);
  return (c.extraSupported ?? []).map((name) => ({ name, isRequired: req.has(name) }));
}

/** Catalogs that can be shown as a plain home row (no required extras). */
export function isBoardCatalog(c: CatalogDef): boolean {
  return !catalogExtras(c).some((e) => e.isRequired);
}

export function supportsSearch(c: CatalogDef): boolean {
  return catalogExtras(c).some((e) => e.name === 'search');
}

// ---------- Requests ----------

export function fetchManifest(url: string): Promise<Manifest> {
  return getJson<Manifest>(url, requestTimeout).then((m) => {
    if (!m || !m.id || !m.name) throw new Error('That URL did not return a valid Stremio manifest.');
    m.catalogs ??= [];
    m.resources ??= [];
    m.types ??= [];
    return m;
  });
}

export function getCatalog(
  addon: InstalledAddon,
  type: string,
  id: string,
  extra?: Record<string, string | number | undefined>,
): Promise<MetaPreview[]> {
  const url = resourceUrl(addon, 'catalog', type, id, extra);
  return cached(url, 10 * 60_000, () =>
    getJson<{ metas?: MetaPreview[] }>(url, requestTimeout).then((r) =>
      uniqueBy((Array.isArray(r.metas) ? r.metas : []).filter((m) => m && typeof m.id === 'string' && m.id), (m) => m.id),
    ),
  );
}

/** Addons sometimes repeat items; lists are keyed by id, so drop repeats where data comes in. */
export function uniqueBy<T>(list: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** First enabled addon that can resolve the meta wins (addon order = priority). */
export async function getMeta(addons: InstalledAddon[], type: string, id: string): Promise<MetaDetail> {
  const candidates = addons.filter((a) => a.enabled && supports(a, 'meta', type, id));
  let lastErr: unknown = new Error('No installed addon can show details for this item.');
  for (const a of candidates) {
    const url = resourceUrl(a, 'meta', type, id);
    try {
      const meta = await cached(url, 30 * 60_000, () =>
        getJson<{ meta?: MetaDetail }>(url, requestTimeout).then((r) => {
          if (!r.meta) throw new Error('Empty meta');
          const m = r.meta;
          if (Array.isArray(m.videos)) m.videos = uniqueBy(m.videos.filter((v) => v && typeof v.id === 'string'), (v) => v.id);
          return m;
        }),
      );
      return meta;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Queries every stream addon in parallel and reports results as each one
 * answers, so fast addons show up immediately instead of waiting on slow ones.
 */
export function getStreams(
  addons: InstalledAddon[],
  type: string,
  id: string,
  onUpdate: (streams: SourcedStream[], pending: number, errors: string[]) => void,
): Promise<void> {
  const sources = addons.filter((a) => a.enabled && supports(a, 'stream', type, id));
  const all: SourcedStream[] = [];
  const errors: string[] = [];
  let pending = sources.length;
  onUpdate([], pending, errors);

  return Promise.all(
    sources.map(async (a) => {
      const url = resourceUrl(a, 'stream', type, id);
      try {
        const streams = await cached(url, 2 * 60_000, () =>
          getJson<{ streams?: Stream[] }>(url, requestTimeout).then((r) => r.streams ?? []),
        );
        all.push(...streams.map((s) => ({ ...s, addonName: a.manifest.name, addonId: a.manifest.id })));
      } catch (e) {
        errors.push(`${a.manifest.name}: ${(e as Error).message}`);
      } finally {
        pending--;
        onUpdate([...all], pending, [...errors]);
      }
    }),
  ).then(() => undefined);
}

export async function getSubtitles(addons: InstalledAddon[], type: string, id: string): Promise<Subtitle[]> {
  const sources = addons.filter((a) => a.enabled && supports(a, 'subtitles', type, id));
  const results = await Promise.allSettled(
    sources.map((a) => {
      const url = resourceUrl(a, 'subtitles', type, id);
      return cached(url, 30 * 60_000, () =>
        getJson<{ subtitles?: Subtitle[] }>(url, requestTimeout).then((r) => r.subtitles ?? []),
      );
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
