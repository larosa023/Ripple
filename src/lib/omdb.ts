// Rotten Tomatoes and Metacritic scores from OMDb (free key: omdbapi.com/apikey.aspx),
// cached for a week so each title is looked up at most once.
import { getJson } from './stremio/http';
import { settings } from './stores/settings.svelte';

export interface Scores {
  /** Tomatometer, 0–100. */
  rt: number | null;
  /** Metascore, 0–100. */
  mc: number | null;
  imdb: string | null;
}

const KEY = 'ripple:omdb';
const WEEK = 7 * 864e5;
type Cache = Record<string, Scores & { at: number }>;

function read(): Cache {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Cache;
  } catch {
    return {};
  }
}
function write(c: Cache) {
  // Keep the newest 400 titles.
  const entries = Object.entries(c).sort((a, b) => b[1].at - a[1].at).slice(0, 400);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full: scores just won't be cached */
  }
}

interface OmdbReply {
  Response?: string;
  Error?: string;
  imdbRating?: string;
  Metascore?: string;
  Ratings?: { Source: string; Value: string }[];
}

const num = (v?: string | null) => {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

function parse(r: OmdbReply): Scores {
  const rt = r.Ratings?.find((x) => x.Source === 'Rotten Tomatoes')?.Value;
  const mc = r.Ratings?.find((x) => x.Source === 'Metacritic')?.Value?.split('/')[0] ?? r.Metascore;
  return { rt: num(rt), mc: mc && mc !== 'N/A' ? num(mc) : null, imdb: r.imdbRating && r.imdbRating !== 'N/A' ? r.imdbRating : null };
}

/** Scores for an IMDb id (tt…), or null with no key / no match. */
export async function scoresFor(imdbId: string): Promise<Scores | null> {
  const key = settings.omdbKey.trim();
  if (!key || !/^tt\d+$/.test(imdbId)) return null;
  const cache = read();
  const hit = cache[imdbId];
  if (hit && Date.now() - hit.at < WEEK) return hit;
  try {
    const r = await getJson<OmdbReply>(`https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(key)}`, 8000);
    if (r.Response === 'False') return null;
    const s = parse(r);
    cache[imdbId] = { ...s, at: Date.now() };
    write(cache);
    return s;
  } catch {
    return hit ?? null; // offline: an old score beats none
  }
}

/** Checks a key with a known title. */
export async function testOmdbKey(key: string): Promise<boolean> {
  try {
    const r = await getJson<OmdbReply>(`https://www.omdbapi.com/?i=tt0133093&apikey=${encodeURIComponent(key.trim())}`, 8000);
    return r.Response === 'True';
  } catch {
    return false;
  }
}
