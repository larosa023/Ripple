// Home's "Up Next" (the next unwatched episode of every show you're following) and
// "Because you watched…" (recommendations from titles you actually finished).
import { airDate } from './dates';
import { enabledAddons } from './stores/addons.svelte';
import { isWatched, library } from './stores/library.svelte';
import { getMeta } from './stremio/client';
import { hasTmdb, titleExtras } from './tmdb';
import type { MetaDetail, MetaPreview, Video } from './stremio/types';

export interface UpNextItem {
  meta: MetaDetail;
  video: Video;
  /** Aired in the last week. */
  fresh: boolean;
}

const released = (v: Video) => !v.released || airDate(v.released) <= new Date();
const order = (a: Video, b: Video) =>
  (a.season || 9999) - (b.season || 9999) || (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0);

/** The episode after the last one you finished, if it's out and you haven't started it. */
export function nextUnwatched(meta: MetaDetail): Video | null {
  const eps = (meta.videos ?? []).filter((v) => (v.season ?? 0) > 0).sort(order);
  let last = -1;
  eps.forEach((v, i) => {
    if (isWatched(v.id)) last = i;
  });
  if (last < 0) return null; // never finished an episode: not "following" it yet
  const next = eps.slice(last + 1).find((v) => !isWatched(v.id));
  if (!next || !released(next)) return null;
  // Half-watched episodes already sit in Continue watching.
  const p = library.progress?.[next.id];
  if (p && p.t > 30) return null;
  return next;
}

/** The next `count` released episodes after the last one you finished (for auto-download). */
export function upcomingUnwatched(meta: MetaDetail, count: number): Video[] {
  const eps = (meta.videos ?? []).filter((v) => (v.season ?? 0) > 0).sort(order);
  let last = -1;
  eps.forEach((v, i) => {
    if (isWatched(v.id)) last = i;
  });
  if (last < 0) return [];
  return eps.slice(last + 1).filter((v) => !isWatched(v.id) && released(v)).slice(0, count);
}

export const upNext: { items: UpNextItem[]; ready: boolean } = $state({ items: [], ready: false });

let run = 0;
/** Recomputes Up Next from your history (shows are fetched from cache, so this is quick). */
export async function refreshUpNext() {
  const token = ++run;
  const shows = library.history.filter((h) => h.meta.type === 'series').slice(0, 15);
  const out: UpNextItem[] = [];
  await Promise.all(
    shows.map(async (h, i) => {
      try {
        const meta = await getMeta(enabledAddons(), 'series', h.meta.id);
        const video = nextUnwatched(meta);
        if (video) {
          const fresh = !!video.released && Date.now() - airDate(video.released).getTime() < 7 * 864e5;
          out[i] = { meta, video, fresh };
        }
      } catch {
        /* skip shows we can't load */
      }
    }),
  );
  if (token !== run) return;
  upNext.items = out.filter(Boolean);
  upNext.ready = true;
}

// ---------- Because you watched ----------

export interface ForYouRow {
  seed: MetaPreview;
  items: MetaPreview[];
}

/** Titles you finished (a movie, or at least one episode), most recent first. */
function finishedTitles(): MetaPreview[] {
  return library.history
    .filter((h) => {
      if (isWatched(h.videoId)) return true;
      const p = library.progress?.[h.videoId];
      return !!p && p.d > 0 && p.t / p.d > 0.7;
    })
    .map((h) => h.meta);
}

const cache = new Map<string, MetaPreview[]>();
/** Up to `count` rows of recommendations, skipping anything you've already started. */
export async function becauseYouWatched(count = 2): Promise<ForYouRow[]> {
  if (!hasTmdb()) return [];
  const seen = new Set(library.history.map((h) => h.meta.id));
  const rows: ForYouRow[] = [];
  for (const seed of finishedTitles()) {
    if (rows.length >= count) break;
    try {
      let recs = cache.get(seed.id);
      if (!recs) {
        recs = (await titleExtras(seed as MetaDetail)).recommended;
        cache.set(seed.id, recs);
      }
      const items = recs.filter((m) => !seen.has(m.id) && !rows.some((r) => r.items.some((x) => x.id === m.id)));
      if (items.length >= 5) rows.push({ seed, items: items.slice(0, 20) });
    } catch {
      /* TMDB unreachable or no match: try the next title */
    }
  }
  return rows;
}
