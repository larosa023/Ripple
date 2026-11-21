// TMDB extras: people pages, "More like this", and movie collections (franchises).
// Needs the free TMDB key from Settings → Integrations. Titles from TMDB are shown with
// "tmdb:<id>" ids; opening one swaps in the IMDb id so every addon understands it.
import { tmdb } from './stremio/cast';
import type { MetaDetail, MetaPreview } from './stremio/types';
import { settings } from './stores/settings.svelte';

const IMG = 'https://image.tmdb.org/t/p/';
/** TMDB TV genres for talk shows, news and reality: appearances there aren't roles. */
const NOT_ROLES = [10767, 10763, 10764];

interface TItem {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  overview?: string;
  genre_ids?: number[];
  character?: string;
  job?: string;
  department?: string;
  episode_count?: number;
}

export function hasTmdb(): boolean {
  return !!settings.tmdbKey.trim();
}

const memo = new Map<string, Promise<unknown>>();
function call<T>(path: string): Promise<T> {
  const key = settings.tmdbKey.trim();
  if (!key) return Promise.reject(new Error('Add a TMDB key in Settings → Integrations.'));
  const k = `${key.slice(0, 6)}${path}`;
  if (!memo.has(k)) {
    const p = tmdb<T>(path, key).catch((e) => {
      memo.delete(k);
      throw e;
    });
    memo.set(k, p);
  }
  return memo.get(k) as Promise<T>;
}

/** A TMDB title as a poster Ripple can show (id "tmdb:123"). */
export function toPreview(t: TItem, kind: 'movie' | 'tv'): MetaPreview {
  const date = t.release_date || t.first_air_date || '';
  return {
    id: `tmdb:${t.id}`,
    type: kind === 'tv' ? 'series' : 'movie',
    name: t.title || t.name || 'Untitled',
    poster: t.poster_path ? `${IMG}w342${t.poster_path}` : undefined,
    background: t.backdrop_path ? `${IMG}w780${t.backdrop_path}` : undefined,
    releaseInfo: date.slice(0, 4) || undefined,
    imdbRating: t.vote_average ? t.vote_average.toFixed(1) : undefined,
    description: t.overview,
  } as MetaPreview;
}

/** TMDB id for a title (from the meta, or looked up by IMDb id). */
export async function tmdbIdOf(meta: Pick<MetaDetail, 'id' | 'type' | 'imdb_id' | 'moviedb_id'>): Promise<number | null> {
  if (meta.id.startsWith('tmdb:')) return Number(meta.id.slice(5).split(':')[0]) || null;
  if (meta.type === 'movie' && meta.moviedb_id) return Number(meta.moviedb_id) || null;
  const imdb = meta.imdb_id ?? (meta.id.startsWith('tt') ? meta.id.split(':')[0] : '');
  if (!imdb) return null;
  const found = await call<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(`/find/${imdb}?external_source=imdb_id`);
  const tv = meta.type === 'series';
  return (tv ? found.tv_results : found.movie_results)?.[0]?.id ?? null;
}

const imdbMemo = new Map<string, string | null>();
/** IMDb id for a TMDB title, so Cinemeta and stream addons can find it. */
export async function imdbOf(kind: 'movie' | 'tv', id: number): Promise<string | null> {
  const k = `${kind}:${id}`;
  if (imdbMemo.has(k)) return imdbMemo.get(k)!;
  const r = await call<{ imdb_id?: string | null }>(`/${kind}/${id}/external_ids`);
  const v = r.imdb_id && /^tt\d+$/.test(r.imdb_id) ? r.imdb_id : null;
  imdbMemo.set(k, v);
  return v;
}

export interface TitleExtras {
  recommended: MetaPreview[];
  collection: { name: string; items: MetaPreview[] } | null;
}

/** "More like this" and, for movies in a franchise, the whole collection in release order. */
export async function titleExtras(meta: MetaDetail): Promise<TitleExtras> {
  const id = await tmdbIdOf(meta);
  if (!id) return { recommended: [], collection: null };
  const kind = meta.type === 'series' ? 'tv' : 'movie';
  const r = await call<{
    belongs_to_collection?: { id: number; name: string } | null;
    recommendations?: { results?: TItem[] };
    similar?: { results?: TItem[] };
  }>(`/${kind}/${id}?append_to_response=recommendations,similar`);
  let list = r.recommendations?.results ?? [];
  if (list.length < 6) list = [...list, ...(r.similar?.results ?? [])];
  const seen = new Set<number>([id]);
  const recommended = list
    .filter((t) => t.poster_path && !seen.has(t.id) && seen.add(t.id))
    .slice(0, 20)
    .map((t) => toPreview(t, kind));

  let collection: TitleExtras['collection'] = null;
  if (kind === 'movie' && r.belongs_to_collection?.id) {
    try {
      const c = await call<{ name: string; parts?: TItem[] }>(`/collection/${r.belongs_to_collection.id}`);
      const parts = (c.parts ?? [])
        .filter((p) => p.release_date)
        .sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''));
      if (parts.length > 1) collection = { name: c.name, items: parts.map((p) => toPreview(p, 'movie')) };
    } catch {
      /* collection is a bonus */
    }
  }
  return { recommended, collection };
}

export interface PersonPage {
  id: number;
  name: string;
  photo: string;
  biography: string;
  department: string;
  birthday: string;
  deathday: string;
  birthplace: string;
  imdb: string;
  /** Acting credits (or crew credits for directors/writers), most notable first. */
  knownFor: (MetaPreview & { role: string })[];
  movies: (MetaPreview & { role: string })[];
  shows: (MetaPreview & { role: string })[];
}

export async function getPerson(id: number): Promise<PersonPage> {
  const p = await call<{
    id: number;
    name: string;
    profile_path?: string | null;
    biography?: string;
    known_for_department?: string;
    birthday?: string | null;
    deathday?: string | null;
    place_of_birth?: string | null;
    imdb_id?: string | null;
    combined_credits?: { cast?: TItem[]; crew?: TItem[] };
  }>(`/person/${id}?append_to_response=combined_credits`);
  const acting = (p.known_for_department ?? 'Acting') === 'Acting';
  const raw = acting ? (p.combined_credits?.cast ?? []) : (p.combined_credits?.crew ?? []).filter((c) => c.department === p.known_for_department);
  // One entry per title (crew can list the same film for several jobs); skip talk shows and the like.
  const byId = new Map<string, TItem>();
  for (const c of raw) {
    if (c.media_type !== 'movie' && c.media_type !== 'tv') continue;
    if (c.media_type === 'tv' && c.genre_ids?.some((g) => NOT_ROLES.includes(g))) continue;
    const k = `${c.media_type}:${c.id}`;
    const prev = byId.get(k);
    if (prev) {
      const role = acting ? prev.character : [prev.job, c.job].filter(Boolean).join(', ');
      byId.set(k, { ...prev, character: role, job: role });
    } else byId.set(k, c);
  }
  const all = [...byId.values()].filter((c) => c.poster_path);
  const roleOf = (c: TItem) => (acting ? (c.character ?? '') : (c.job ?? '')).replace(/\s*\(voice\)/i, ' (voice)').trim();
  const year = (c: TItem) => (c.release_date || c.first_air_date || '0000').slice(0, 4);
  const toItem = (c: TItem) => ({ ...toPreview(c, c.media_type as 'movie' | 'tv'), role: roleOf(c) });
  // Notable = lots of votes, and for TV, a real part (not a one-episode cameo or talk-show visit).
  const notable = [...all]
    .filter((c) => c.media_type === 'movie' || (c.episode_count ?? 2) > 1)
    .sort((a, b) => (b.vote_count ?? 0) * Math.log10(10 + (b.popularity ?? 0)) - (a.vote_count ?? 0) * Math.log10(10 + (a.popularity ?? 0)))
    .slice(0, 16);
  const newestFirst = (a: TItem, b: TItem) => year(b).localeCompare(year(a));
  return {
    id: p.id,
    name: p.name,
    photo: p.profile_path ? `${IMG}h632${p.profile_path}` : '',
    biography: (p.biography ?? '').trim(),
    department: p.known_for_department ?? '',
    birthday: p.birthday ?? '',
    deathday: p.deathday ?? '',
    birthplace: p.place_of_birth ?? '',
    imdb: p.imdb_id ?? '',
    knownFor: notable.map(toItem),
    movies: all.filter((c) => c.media_type === 'movie').sort(newestFirst).map(toItem),
    shows: all.filter((c) => c.media_type === 'tv').sort(newestFirst).map(toItem),
  };
}

export interface PersonHit {
  id: number;
  name: string;
  photo: string;
  knownFor: string;
}

/** People matching a search (actors, directors), most popular first. */
export async function searchPeople(q: string): Promise<PersonHit[]> {
  const r = await call<{ results?: { id: number; name: string; profile_path?: string | null; popularity?: number; known_for_department?: string; known_for?: TItem[] }[] }>(
    `/search/person?query=${encodeURIComponent(q)}&include_adult=false`,
  );
  return (r.results ?? [])
    .filter((p) => p.profile_path && (p.popularity ?? 0) > 1)
    .slice(0, 12)
    .map((p) => ({
      id: p.id,
      name: p.name,
      photo: `${IMG}w185${p.profile_path}`,
      knownFor: (p.known_for ?? []).map((k) => k.title || k.name).filter(Boolean).slice(0, 2).join(', ') || (p.known_for_department ?? ''),
    }));
}
