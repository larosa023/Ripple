// Imports watch history from a list ("Snowfall up to S4E3", "all of Dark", "Obsession 3 times"):
// marks those episodes/movies watched, adds their (estimated) time to Your stats, and puts
// shows you're partway through into Up next / Continue watching.
import { enabledAddons } from './stores/addons.svelte';
import { library, setWatched } from './stores/library.svelte';
import { getCatalog, getMeta } from './stremio/client';
import { airDate } from './dates';
import { log, persist } from './stats.svelte';
import type { MetaDetail, Video } from './stremio/types';

export interface ImportItem {
  name: string;
  type: 'series' | 'movie';
  /** IMDb id (checked against the catalog before use). */
  imdb?: string;
  /** Release year, to pick the right title when searching by name. */
  year?: number;
  /** Series: every released episode. */
  all?: boolean;
  /** Series: everything up to and including this episode. */
  upTo?: { season: number; episode: number };
  /** Series: these whole seasons. */
  seasons?: number[];
  /** Movies: times watched (default 1). */
  times?: number;
}

export interface ImportFile {
  ripple: 'watch-history';
  version: 1;
  items: ImportItem[];
}

export interface ImportResult {
  name: string;
  /** What it matched in the catalog. */
  matched?: string;
  episodes?: number;
  kind?: 'series' | 'movie';
  skipped?: boolean;
  error?: string;
}

/** Day key for history with no date: counted in All time only. */
export const UNDATED = 'earlier';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const sameName = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};
const yearOf = (m: { releaseInfo?: string; year?: string | number }) => parseInt(String(m.releaseInfo ?? m.year ?? ''), 10) || 0;

async function resolve(item: ImportItem): Promise<MetaDetail> {
  const addons = enabledAddons();
  if (item.imdb) {
    try {
      const m = await getMeta(addons, item.type, item.imdb);
      if (m && sameName(m.name, item.name)) return m;
    } catch {
      /* fall back to searching */
    }
  }
  const searchable = addons.filter((a) =>
    (a.manifest.catalogs ?? []).some((c) => c.type === item.type && (c.extra ?? []).some((e) => e.name === 'search')),
  );
  for (const a of searchable) {
    const cat = a.manifest.catalogs!.find((c) => c.type === item.type && (c.extra ?? []).some((e) => e.name === 'search'))!;
    let results;
    try {
      results = await getCatalog(a, item.type, cat.id, { search: item.name });
    } catch {
      continue;
    }
    const named = results.filter((r) => sameName(r.name, item.name));
    const pick =
      (item.year && named.find((r) => yearOf(r) === item.year)) ||
      (item.year && named.find((r) => Math.abs(yearOf(r) - item.year!) <= 1)) ||
      (!item.year && named[0]);
    if (pick) return getMeta(addons, item.type, pick.id);
  }
  throw new Error("Couldn't find it in your addons' catalogs.");
}

/** Minutes per episode / movie from "58 min", "1h 52m"… */
function runtimeMinutes(meta: MetaDetail): number {
  const r = String(meta.runtime ?? '');
  const h = /(\d+)\s*h/.exec(r);
  const m = /(\d+)\s*m/.exec(r);
  const total = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) || parseInt(r, 10) || 0;
  if (total >= 5 && total <= 400) return total;
  return meta.type === 'movie' ? 110 : 45;
}

function episodesFor(meta: MetaDetail, item: ImportItem): Video[] {
  const eps = (meta.videos ?? [])
    .filter((v) => (v.season ?? 0) > 0 && (!v.released || airDate(v.released) <= new Date()))
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
  if (item.all) return eps;
  if (item.seasons?.length) return eps.filter((v) => item.seasons!.includes(v.season ?? 0));
  if (item.upTo) {
    const { season, episode } = item.upTo;
    return eps.filter((v) => (v.season ?? 0) < season || ((v.season ?? 0) === season && (v.episode ?? v.number ?? 0) <= episode));
  }
  return [];
}

/** Checks a parsed file looks like ours. */
export function isImportFile(x: unknown): x is ImportFile {
  const f = x as ImportFile;
  return !!f && f.ripple === 'watch-history' && Array.isArray(f.items);
}

export async function importHistory(file: ImportFile, onProgress?: (done: number, total: number) => void): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  const imported = new Set(log.imported ?? []);
  const inProgress: { meta: MetaDetail; last: Video }[] = [];
  let i = 0;
  for (const item of file.items) {
    onProgress?.(i++, file.items.length);
    const key = JSON.stringify([item.type, item.name, item.year ?? 0, item.all ?? 0, item.upTo ?? 0, item.seasons ?? 0, item.times ?? 1]);
    if (imported.has(key)) {
      out.push({ name: item.name, skipped: true });
      continue;
    }
    try {
      const meta = await resolve(item);
      const minutes = runtimeMinutes(meta);
      let ids: string[];
      let plays: number;
      if (item.type === 'movie') {
        const vid = meta.behaviorHints?.defaultVideoId ?? meta.id;
        ids = [vid];
        plays = Math.max(1, Math.min(20, item.times ?? 1));
      } else {
        const eps = episodesFor(meta, item);
        if (!eps.length) throw new Error('No matching episodes.');
        ids = eps.map((v) => v.id);
        plays = ids.length;
        const allReleased = episodesFor(meta, { ...item, all: true, upTo: undefined, seasons: undefined });
        if (ids.length < allReleased.length) inProgress.push({ meta, last: eps[eps.length - 1] });
      }
      setWatched(ids, true);
      log.titles[meta.id] = { name: meta.name, type: meta.type, poster: meta.poster, genres: meta.genres?.slice(0, 4) };
      const day = (log.days[UNDATED] ??= {});
      day[meta.id] = (day[meta.id] ?? 0) + plays * minutes * 60;
      for (let n = 0; n < plays; n++) log.finished.push({ v: ids[Math.min(n, ids.length - 1)], m: meta.id, at: 0 });
      imported.add(key);
      out.push({ name: item.name, matched: `${meta.name}${yearOf(meta) ? ` (${yearOf(meta)})` : ''}`, episodes: item.type === 'series' ? ids.length : plays, kind: item.type });
    } catch (e) {
      out.push({ name: item.name, error: (e as Error)?.message ?? String(e) });
    }
  }
  log.imported = [...imported];

  // Partway-through shows: into history (dated over three weeks ago, so "Keep next episodes
  // downloaded" doesn't suddenly fetch a pile of them) for Up next and Continue watching.
  const base = Date.now() - 22 * 864e5;
  const fresh = inProgress
    .filter(({ meta }) => !library.history.some((h) => h.meta.id === meta.id))
    .map(({ meta, last }, k) => ({
      meta: { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, background: meta.background },
      videoId: last.id,
      label: [last.season != null ? `S${last.season}E${last.episode ?? last.number}` : '', last.title ?? last.name ?? ''].filter(Boolean).join(' · '),
      watchedAt: base - k * 60_000,
    }));
  library.history = [...library.history, ...fresh].slice(0, 50);
  persist();
  onProgress?.(file.items.length, file.items.length);
  return out;
}
