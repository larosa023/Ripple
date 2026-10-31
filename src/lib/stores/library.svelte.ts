import type { MetaPreview } from '../stremio/types';
import { load, save } from './persist';

export interface LibraryItem {
  meta: MetaPreview;
  addedAt: number;
}

export interface HistoryItem {
  meta: MetaPreview;
  /** Stremio video id, e.g. tt0903747:1:3 for series episodes. */
  videoId: string;
  label: string;
  watchedAt: number;
}

export interface Progress {
  /** Seconds watched */
  t: number;
  /** Duration in seconds */
  d: number;
  at: number;
}

interface LibraryState {
  saved: LibraryItem[];
  history: HistoryItem[];
  watched: string[];
  /** Playback position per video id, for resuming. */
  progress: Record<string, Progress>;
}

export const library: LibraryState = $state(load('library', { saved: [], history: [], watched: [], progress: {} }));

$effect.root(() => {
  $effect(() => {
    save('library', $state.snapshot(library));
  });
});

function slim(m: MetaPreview): MetaPreview {
  const { id, type, name, poster, posterShape, background, releaseInfo, imdbRating } = m;
  return { id, type, name, poster, posterShape, background, releaseInfo, imdbRating };
}

export function isSaved(id: string): boolean {
  return library.saved.some((i) => i.meta.id === id);
}

export function toggleSaved(meta: MetaPreview) {
  if (isSaved(meta.id)) library.saved = library.saved.filter((i) => i.meta.id !== meta.id);
  else library.saved.unshift({ meta: slim(meta), addedAt: Date.now() });
}

export function recordPlay(meta: MetaPreview, videoId: string, label: string) {
  library.history = [
    { meta: slim(meta), videoId, label, watchedAt: Date.now() },
    ...library.history.filter((h) => h.meta.id !== meta.id),
  ].slice(0, 50);
  if (!library.watched.includes(videoId)) library.watched.push(videoId);
}

export function isWatched(videoId: string): boolean {
  return library.watched.includes(videoId);
}

export function toggleWatched(videoId: string) {
  if (isWatched(videoId)) library.watched = library.watched.filter((v) => v !== videoId);
  else library.watched.push(videoId);
}

export function removeFromHistory(id: string) {
  library.history = library.history.filter((h) => h.meta.id !== id);
}

export function saveProgress(videoId: string, t: number, d: number) {
  if (!(d > 0) || !(t >= 0)) return;
  library.progress ??= {};
  if (d - t < 60 || t / d > 0.95) {
    // Finished: forget the position and count it as watched.
    delete library.progress[videoId];
    if (!library.watched.includes(videoId)) library.watched.push(videoId);
    return;
  }
  library.progress[videoId] = { t: Math.round(t), d: Math.round(d), at: Date.now() };
  // Keep the map small.
  const keys = Object.keys(library.progress);
  if (keys.length > 300) {
    keys.sort((a, b) => library.progress[a].at - library.progress[b].at).slice(0, keys.length - 300).forEach((k) => delete library.progress[k]);
  }
}

export function resumePoint(videoId: string): number {
  const p = library.progress?.[videoId];
  return p && p.t > 30 && p.d - p.t > 60 ? p.t : 0;
}
