// Starting streams, choosing the next episode's source, and remembering what
// you picked per show.
import { getStreams } from './stremio/client';
import { airDate } from './dates';
import { describe, filterAndSort, quality } from './stremio/streams';
import type { MetaDetail, SourcedStream, Video } from './stremio/types';
import { isTauri } from './stremio/http';
import { playExternal, prepare } from './player';
import { enabledAddons } from './stores/addons.svelte';
import { recordPlay } from './stores/library.svelte';
import { openPlayer, playback } from './stores/playback.svelte';
import { settings } from './stores/settings.svelte';
import { rememberShow, shows } from './stores/shows.svelte';
import { toast } from './stores/toast.svelte';

export interface PlayInfo {
  meta: MetaDetail;
  videoId: string;
  label: string;
}

export const isEpisodic = (meta: { type: string }) => meta.type !== 'movie';

export function epCode(v: Video): string {
  const n = v.episode ?? v.number;
  return v.season != null && n != null ? `S${v.season}E${n}` : '';
}

export function epLabel(v: Video): string {
  return [epCode(v), v.title ?? v.name ?? ''].filter(Boolean).join(' · ');
}

const unreleased = (v: Video) => !!v.released && airDate(v.released) > new Date();
const byOrder = (a: Video, b: Video) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0);

/** The released episode after `videoId`, skipping specials (season 0). */
export function nextVideo(meta: MetaDetail, videoId: string): Video | null {
  const ordered = (meta.videos ?? []).filter((v) => (v.season ?? 0) > 0).sort(byOrder);
  const i = ordered.findIndex((v) => v.id === videoId);
  const next = i >= 0 ? ordered[i + 1] : undefined;
  return next && !unreleased(next) ? next : null;
}

/** Plays a stream in Ripple or the external player. Throws on failure. */
export async function playStream(s: SourcedStream, info: PlayInfo): Promise<void> {
  const { meta, videoId, label } = info;
  const prepared = await prepare(s, { title: meta.name, type: meta.type, videoId, addons: enabledAddons() });
  if (!prepared) return; // opened in the browser
  if (settings.rememberPerShow && isEpisodic(meta)) {
    const d = describe(s);
    rememberShow(meta.id, { addonId: s.addonId, bingeGroup: s.behaviorHints?.bingeGroup, quality: quality(s), service: d.service || undefined });
  }
  if (settings.playIn === 'ripple' && isTauri) {
    await openPlayer(prepared, { title: meta.name, subtitle: label, meta, videoId, stream: s });
  } else {
    await playExternal(prepared, label ? `${meta.name} — ${label}` : meta.name);
    recordPlay(meta, videoId, label, true);
    toast('Opening player…', 'success', 2000);
  }
}

/** How closely a candidate matches what you were watching (higher is better). */
function score(s: SourcedStream, prev: SourcedStream | null, meta: MetaDetail): number {
  const pref = shows[meta.id];
  const group = prev?.behaviorHints?.bingeGroup ?? pref?.bingeGroup;
  let n = 0;
  if (group && s.behaviorHints?.bingeGroup === group) n += 100;
  const addon = prev?.addonId ?? pref?.addonId;
  if (addon && s.addonId === addon) n += 20;
  const q = prev ? quality(prev) : pref?.quality;
  if (q && quality(s) === q) n += 10;
  const svc = prev ? describe(prev).service : pref?.service;
  const d = describe(s);
  if (svc && d.service === svc) n += 5;
  if (d.cached) n += 2;
  return n;
}

/**
 * Finds the best stream for an episode, preferring the same release group
 * (bingeGroup), addon, quality and debrid service as before. Resolves as soon
 * as an exact bingeGroup match turns up, else when every addon has answered.
 */
export function pickStream(meta: MetaDetail, videoId: string, prev: SourcedStream | null): Promise<SourcedStream | null> {
  const order = enabledAddons().map((a) => a.manifest.id);
  const group = prev?.behaviorHints?.bingeGroup ?? shows[meta.id]?.bingeGroup;
  const filters = {
    hideCam: settings.hideCam,
    excludeKeywords: settings.excludeKeywords.split(','),
    qualities: settings.qualities,
    onlyDirect: settings.onlyDirect,
  };
  const playable = (list: SourcedStream[]) =>
    filterAndSort(list, filters, settings.streamSort, order).filter((s) => s.url || s.infoHash);
  const best = (list: SourcedStream[]) => {
    const c = playable(list);
    if (!c.length) return null;
    return c.reduce((a, b) => (score(b, prev, meta) > score(a, prev, meta) ? b : a), c[0]);
  };
  return new Promise((resolve) => {
    let done = false;
    let latest: SourcedStream[] = [];
    getStreams(enabledAddons(), meta.type, videoId, (list) => {
      latest = list;
      if (done || !group) return;
      try {
        const hit = playable(list).find((s) => s.behaviorHints?.bingeGroup === group);
        if (hit) {
          done = true;
          resolve(hit);
        }
      } catch {
        /* odd addon data: keep waiting for the rest */
      }
    })
      .then(() => {
        if (!done) resolve(best(latest));
      })
      .catch(() => resolve(null));
  });
}

// ---------- next episode ----------

let noNextFor: unknown = null;

/** Looks up the next episode and its source in the background (once per playback). */
export function prefetchNext() {
  const meta = playback.meta as MetaDetail | null;
  // playback.next is cleared on every open, so rewatching the same episode looks it up again.
  if (!meta || !isEpisodic(meta) || playback.next || noNextFor === playback.source) return;
  const v = nextVideo(meta, playback.videoId);
  if (!v) {
    noNextFor = playback.source; // last episode: don't recompute on every tick
    return;
  }
  const forVideo = playback.videoId;
  playback.next = { video: v, label: epLabel(v), stream: null, status: 'finding' };
  void pickStream(meta, v.id, playback.stream).then((s) => {
    if (playback.videoId !== forVideo || !playback.next) return;
    playback.next.stream = s;
    playback.next.status = s ? 'ready' : 'none';
  });
}

/** Starts the next episode in the same player window. */
let starting = false;

export async function playNext() {
  const meta = playback.meta as MetaDetail | null;
  const next = playback.next;
  if (!meta || !next || starting) return;
  starting = true;
  try {
    await startNext(meta, next);
  } finally {
    starting = false;
  }
}

async function startNext(meta: MetaDetail, next: NonNullable<typeof playback.next>) {
  let s = next.stream;
  if (!s && next.status === 'finding') s = await pickStream(meta, next.video.id, playback.stream);
  if (!s) {
    toast(`Couldn't find a source for ${epCode(next.video) || 'the next episode'}. Pick one from the episode list.`, 'error', 7000);
    return;
  }
  try {
    await playStream(s, { meta, videoId: next.video.id, label: next.label });
  } catch (e) {
    toast((e as Error)?.message ?? String(e), 'error', 6000);
  }
}
