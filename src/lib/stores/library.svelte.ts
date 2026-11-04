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

/**
 * Adds to Continue watching. `markWatched` is for external players, where Ripple can't see
 * progress; the built-in player marks a video watched when you actually finish it (saveProgress).
 */
export function recordPlay(meta: MetaPreview, videoId: string, label: string, markWatched = false) {
  library.history = [
    { meta: slim(meta), videoId, label, watchedAt: Date.now() },
    ...library.history.filter((h) => h.meta.id !== meta.id),
  ].slice(0, 50);
  if (markWatched && !library.watched.includes(videoId)) library.watched.push(videoId);
}

export function isWatched(videoId: string): boolean {
  return library.watched.includes(videoId);
}

export function toggleWatched(videoId: string) {
  if (isWatched(videoId)) library.watched = library.watched.filter((v) => v !== videoId);
  else library.watched.push(videoId);
}

/** Marks many videos at once (a season, or everything up to an episode). */
export function setWatched(ids: string[], on: boolean) {
  if (on) {
    const have = new Set(library.watched);
    library.watched.push(...ids.filter((id) => !have.has(id)));
    for (const id of ids) delete library.progress?.[id];
  } else {
    const drop = new Set(ids);
    library.watched = library.watched.filter((v) => !drop.has(v));
  }
}

export function removeFromHistory(id: string) {
  library.history = library.history.filter((h) => h.meta.id !== id);
}

/**
 * Removes a title from Continue Watching (history + saved positions).
 * Returns a function that undoes it.
 */
export function removeFromContinue(id: string): () => void {
  const idx = library.history.findIndex((h) => h.meta.id === id);
  if (idx < 0) return () => {};
  const item = $state.snapshot(library.history[idx]) as HistoryItem;
  const progress = Object.fromEntries(
    Object.entries($state.snapshot(library.progress ?? {})).filter(([k]) => k === id || k.startsWith(id + ':')),
  );
  library.history = library.history.filter((h) => h.meta.id !== id);
  for (const k of Object.keys(progress)) delete library.progress[k];
  return () => {
    if (library.history.some((h) => h.meta.id === id)) return;
    const next = [...library.history];
    next.splice(Math.min(idx, next.length), 0, item);
    library.history = next;
    Object.assign(library.progress, progress);
  };
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
