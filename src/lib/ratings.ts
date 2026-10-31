// Episode ratings for a show (TMDB), drawn as a Series Graph-style heatmap.
import { tmdb } from './stremio/cast';
import type { MetaDetail } from './stremio/types';
import { settings } from './stores/settings.svelte';

export interface EpRating {
  episode: number;
  rating: number;
  votes: number;
  name: string;
}

export interface ShowRatings {
  tmdbId: number;
  seasons: { season: number; episodes: EpRating[] }[];
}

const cache = new Map<string, Promise<ShowRatings | null>>();

export function slug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function tmdbTvId(meta: MetaDetail, key: string): Promise<number | null> {
  const imdb = meta.imdb_id ?? (meta.id.startsWith('tt') ? meta.id.split(':')[0] : '');
  if (!imdb) return null;
  const r = await tmdb<{ tv_results?: { id: number }[] }>(`/find/${imdb}?external_source=imdb_id`, key);
  return r.tv_results?.[0]?.id ?? null;
}

/** Ratings for every season. Needs a TMDB key; resolves null without one. */
export function showRatings(meta: MetaDetail): Promise<ShowRatings | null> {
  const key = settings.tmdbKey.trim();
  if (!key) return Promise.resolve(null);
  if (!cache.has(meta.id)) {
    const job = (async () => {
      try {
        const id = await tmdbTvId(meta, key);
        if (!id) return null;
        const show = await tmdb<{ seasons?: { season_number: number }[] }>(`/tv/${id}`, key);
        const nums = (show.seasons ?? []).map((s) => s.season_number).filter((n) => n > 0);
        const seasons: ShowRatings['seasons'] = [];
        // TMDB allows up to 20 appended seasons per request.
        for (let i = 0; i < nums.length; i += 20) {
          const batch = nums.slice(i, i + 20);
          const r = await tmdb<Record<string, { episodes?: { episode_number: number; vote_average: number; vote_count: number; name: string; air_date?: string }[] }>>(
            `/tv/${id}?append_to_response=${batch.map((n) => `season/${n}`).join(',')}`,
            key,
          );
          for (const n of batch) {
            const eps = (r[`season/${n}`]?.episodes ?? [])
              .filter((e) => e.air_date && new Date(e.air_date) <= new Date())
              .map((e) => ({ episode: e.episode_number, rating: e.vote_count ? e.vote_average : 0, votes: e.vote_count, name: e.name }));
            if (eps.length) seasons.push({ season: n, episodes: eps });
          }
        }
        return seasons.length ? { tmdbId: id, seasons } : null;
      } catch {
        return null;
      }
    })();
    cache.set(meta.id, job);
    job.then((r) => r === null && cache.delete(meta.id));
  }
  return cache.get(meta.id)!;
}

/** Series Graph-style color bands. */
export function ratingColor(r: number): string {
  if (!r) return 'var(--bg-3)';
  if (r >= 9) return '#1e88e5';
  if (r >= 8.5) return '#1b8a3e';
  if (r >= 8) return '#3dae4f';
  if (r >= 7.5) return '#8bc34a';
  if (r >= 7) return '#d4c22a';
  if (r >= 6) return '#f08c1a';
  return '#e0412f';
}

export function seriesGraphUrl(r: ShowRatings, name: string): string {
  return `https://seriesgraph.com/show/${r.tmdbId}-${slug(name)}`;
}
