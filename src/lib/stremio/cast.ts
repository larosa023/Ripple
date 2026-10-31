// Full cast with photos. Cinemeta only lists three names, so Ripple asks:
//  1. TMDB, when you've added a free API key (movies and series), else
//  2. TVmaze (series only, no key needed),
//  falling back to whatever the meta addon gave.
import { getJson } from './http';
import type { MetaDetail } from './types';
import { settings } from '../stores/settings.svelte';

export interface Person {
  name: string;
  character: string;
  photo: string;
}

const TMDB = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';
const cache = new Map<string, Promise<Person[]>>();

/** v3 keys go in the query string; v4 read-access tokens (long JWTs) go in a header. */
function tmdb<T>(path: string, key: string): Promise<T> {
  const v4 = key.length > 40;
  const url = `${TMDB}${path}${v4 ? '' : `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`}`;
  return getJson<T>(url, 10000, v4 ? { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } } : {});
}

/** Checks a TMDB key; resolves true when TMDB accepts it. */
export async function testTmdbKey(key: string): Promise<boolean> {
  try {
    await tmdb('/configuration', key.trim());
    return true;
  } catch {
    return false;
  }
}

async function fromTmdb(meta: MetaDetail, key: string): Promise<Person[]> {
  const isTv = meta.type === 'series';
  let id = !isTv ? meta.moviedb_id : undefined;
  const imdb = meta.imdb_id ?? (meta.id.startsWith('tt') ? meta.id.split(':')[0] : '');
  if (!id && imdb) {
    const found = await tmdb<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(
      `/find/${imdb}?external_source=imdb_id`,
      key,
    );
    id = (isTv ? found.tv_results : found.movie_results)?.[0]?.id ?? found.tv_results?.[0]?.id ?? found.movie_results?.[0]?.id;
  }
  if (!id) return [];
  if (isTv) {
    // aggregate_credits covers the whole run of the show, not just the latest season
    const r = await tmdb<{ cast?: { name: string; profile_path?: string | null; roles?: { character?: string }[] }[] }>(
      `/tv/${id}/aggregate_credits`,
      key,
    );
    return (r.cast ?? []).slice(0, 30).map((c) => ({
      name: c.name,
      character: c.roles?.[0]?.character ?? '',
      photo: c.profile_path ? TMDB_IMG + c.profile_path : '',
    }));
  }
  const r = await tmdb<{ cast?: { name: string; character?: string; profile_path?: string | null }[] }>(`/movie/${id}/credits`, key);
  return (r.cast ?? []).slice(0, 30).map((c) => ({
    name: c.name,
    character: c.character ?? '',
    photo: c.profile_path ? TMDB_IMG + c.profile_path : '',
  }));
}

interface MazeCast {
  person: { name: string; image?: { medium?: string } | null };
  character?: { name?: string } | null;
  voice?: boolean;
}

async function fromTvmaze(meta: MetaDetail): Promise<Person[]> {
  const imdb = meta.imdb_id ?? (meta.id.startsWith('tt') ? meta.id.split(':')[0] : '');
  if (meta.type !== 'series' || !imdb) return [];
  const show = await getJson<{ id: number }>(`https://api.tvmaze.com/lookup/shows?imdb=${imdb}`, 10000);
  const cast = await getJson<MazeCast[]>(`https://api.tvmaze.com/shows/${show.id}/cast`, 10000);
  return cast.slice(0, 30).map((c) => ({
    name: c.person.name,
    character: (c.character?.name ?? '') + (c.voice ? ' (voice)' : ''),
    photo: c.person.image?.medium?.replace(/^http:/, 'https:') ?? '',
  }));
}

function fromMeta(meta: MetaDetail): Person[] {
  if (meta.app_extras?.cast?.length) {
    return meta.app_extras.cast.map((c) => ({ name: c.name, character: c.character ?? '', photo: c.photo ?? '' }));
  }
  return (meta.cast ?? []).map((name) => ({ name, character: '', photo: '' }));
}

/** Best available cast for a title; never throws. */
export function getCast(meta: MetaDetail): Promise<Person[]> {
  const base = fromMeta(meta);
  if (base.some((p) => p.photo) && base.length > 3) return Promise.resolve(base);
  const key = settings.tmdbKey.trim();
  const ck = `${meta.type}:${meta.id}:${key ? 'k' : ''}`;
  if (!cache.has(ck)) {
    const job = (async () => {
      if (key) {
        try {
          const p = await fromTmdb(meta, key);
          if (p.length) return p;
        } catch {
          /* bad key or offline: fall through */
        }
      }
      try {
        const p = await fromTvmaze(meta);
        if (p.length) return p;
      } catch {
        /* not on TVmaze */
      }
      return base;
    })();
    cache.set(ck, job);
  }
  return cache.get(ck)!;
}
