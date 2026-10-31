// Letterboxd has no public API, so Ripple links to film pages, imports your
// recent diary from its public RSS feed, and exports a CSV Letterboxd can import.
import { getJson, getText } from './stremio/http';
import { tmdb } from './stremio/cast';
import type { MetaDetail } from './stremio/types';
import { library } from './stores/library.svelte';
import { settings } from './stores/settings.svelte';

export function filmUrl(meta: Pick<MetaDetail, 'id' | 'imdb_id' | 'moviedb_id'>): string | null {
  const imdb = meta.imdb_id ?? (meta.id.startsWith('tt') ? meta.id.split(':')[0] : '');
  if (imdb) return `https://letterboxd.com/imdb/${imdb}/`;
  if (meta.moviedb_id) return `https://letterboxd.com/tmdb/${meta.moviedb_id}/`;
  return null;
}

export const profileUrl = (user: string) => `https://letterboxd.com/${encodeURIComponent(user.trim())}/`;

interface DiaryEntry {
  title: string;
  year: string;
  tmdbId: string;
  watched: string;
}

function parseRss(xml: string): DiaryEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const text = (el: Element, tag: string) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  return [...doc.getElementsByTagName('item')]
    .map((it) => ({
      title: text(it, 'letterboxd:filmTitle'),
      year: text(it, 'letterboxd:filmYear'),
      tmdbId: text(it, 'tmdb:movieId'),
      watched: text(it, 'letterboxd:watchedDate'),
    }))
    .filter((e) => e.title);
}

async function imdbFor(e: DiaryEntry): Promise<string | null> {
  const key = settings.tmdbKey.trim();
  if (key && e.tmdbId) {
    try {
      const r = await tmdb<{ imdb_id?: string }>(`/movie/${e.tmdbId}/external_ids`, key);
      if (r.imdb_id) return r.imdb_id;
    } catch {
      /* fall back to title search */
    }
  }
  try {
    const r = await getJson<{ metas?: { id: string; releaseInfo?: string; name: string }[] }>(
      `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(e.title)}.json`,
      10000,
    );
    const hit = (r.metas ?? []).find((m) => String(m.releaseInfo ?? '').startsWith(e.year)) ?? r.metas?.[0];
    return hit?.id?.startsWith('tt') ? hit.id : null;
  } catch {
    return null;
  }
}

/** Marks films from your Letterboxd diary (the last ~50 entries) as watched. */
export async function importDiary(user: string): Promise<{ found: number; added: number }> {
  if (!user.trim()) throw new Error('Enter your Letterboxd username first.');
  let xml: string;
  try {
    xml = await getText(`${profileUrl(user)}rss/`, 15000);
  } catch {
    throw new Error("Couldn't load that Letterboxd profile. Check the username (and that the profile is public).");
  }
  const entries = parseRss(xml);
  let added = 0;
  for (const e of entries) {
    const id = await imdbFor(e);
    if (id && !library.watched.includes(id)) {
      library.watched.push(id);
      added++;
    }
  }
  return { found: entries.length, added };
}

/** CSV in Letterboxd's import format, for the movies you've watched in Ripple. */
export function exportCsv(): { csv: string; count: number } {
  const metas = new Map<string, { name: string; year: string; at: number }>();
  for (const h of library.history) {
    if (h.meta.type === 'movie') metas.set(h.meta.id, { name: h.meta.name, year: String(h.meta.releaseInfo ?? '').slice(0, 4), at: h.watchedAt });
  }
  for (const s of library.saved) {
    if (s.meta.type === 'movie' && !metas.has(s.meta.id)) metas.set(s.meta.id, { name: s.meta.name, year: String(s.meta.releaseInfo ?? '').slice(0, 4), at: 0 });
  }
  const rows = [...metas.entries()].filter(([id]) => library.watched.includes(id));
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ['imdbID,Title,Year,WatchedDate'];
  for (const [id, m] of rows) lines.push([id, q(m.name), m.year, m.at ? new Date(m.at).toISOString().slice(0, 10) : ''].join(','));
  return { csv: lines.join('\n'), count: rows.length };
}
