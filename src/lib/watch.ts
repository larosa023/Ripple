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
  /** Start here instead of the saved resume point (switching sources mid-episode). */
  startAt?: number;
}

/** Identifies a source regardless of which addon listed it. */
export const streamKey = (s: SourcedStream) => s.url || `${s.infoHash}:${s.fileIdx ?? ''}`;

// Sources already tried for the episode that's playing, so switching never goes back to a dead one.
let triedFor = '';
let tried = new Set<string>();
let switches = 0;
function noteStarted(videoId: string, s: SourcedStream) {
  if (videoId !== triedFor) {
    triedFor = videoId;
    tried = new Set();
    switches = 0;
  }
  tried.add(streamKey(s));
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
  noteStarted(videoId, s);
  const prepared = await prepare(s, { title: meta.name, type: meta.type, videoId, addons: enabledAddons() });
  if (!prepared) return; // opened in the browser
  if (settings.rememberPerShow && isEpisodic(meta)) {
    const d = describe(s);
    rememberShow(meta.id, { addonId: s.addonId, bingeGroup: s.behaviorHints?.bingeGroup, quality: quality(s), service: d.service || undefined });
  }
  if (settings.playIn === 'ripple' && isTauri) {
    await openPlayer(prepared, { title: meta.name, subtitle: label, meta, videoId, stream: s, startAt: info.startAt });
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
export function pickStream(
  meta: MetaDetail,
  videoId: string,
  prev: SourcedStream | null,
  skip?: Set<string>,
): Promise<SourcedStream | null> {
  const order = enabledAddons().map((a) => a.manifest.id);
  const group = prev?.behaviorHints?.bingeGroup ?? shows[meta.id]?.bingeGroup;
  const filters = {
    hideCam: settings.hideCam,
    excludeKeywords: settings.excludeKeywords.split(','),
    qualities: settings.qualities,
    onlyDirect: settings.onlyDirect,
  };
  const playable = (list: SourcedStream[]) =>
    filterAndSort(list, filters, settings.streamSort, order).filter((s) => (s.url || s.infoHash) && !skip?.has(streamKey(s)));
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

// ---------- switching sources ----------

const MAX_SWITCHES = 4;
let switching = false;

/**
 * The source playing failed or stalled: quietly try the next best one you haven't tried
 * for this episode (same release group / quality first) and carry on from the same second.
 * Resolves true if another source was started.
 */
export async function switchSource(reason: 'error' | 'stall'): Promise<boolean> {
  const meta = playback.meta as MetaDetail | null;
  if (!meta || playback.live || switching || !settings.autoSwitch) return false;
  if (playback.videoId !== triedFor || switches >= MAX_SWITCHES) return false;
  switching = true;
  switches++;
  const videoId = playback.videoId;
  const at = playback.time > 5 ? playback.time : undefined;
  const label = playback.subtitle;
  toast(
    `${reason === 'stall' ? 'This source stalled' : "This source isn't working"}. Trying another… (${switches} of ${MAX_SWITCHES})`,
    'info',
    5000,
  );
  try {
    const s = await pickStream(meta, videoId, playback.stream, tried);
    if (!s || playback.videoId !== videoId || !playback.active) {
      if (!s) toast("Couldn't find another working source. Pick one from the list.", 'error', 7000);
      return false;
    }
    await playStream(s, { meta, videoId, label, startAt: at });
    return true;
  } catch (e) {
    toast((e as Error)?.message ?? String(e), 'error', 6000);
    return false;
  } finally {
    switching = false;
  }
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

/** The episode after the one playing, looked up on the spot (null for the last one or a movie). */
export function upNext(): Video | null {
  const meta = playback.meta as MetaDetail | null;
  if (!meta || !isEpisodic(meta)) return null;
  return playback.next?.video ?? nextVideo(meta, playback.videoId);
}

/** Plays any episode of the show that's playing, picking a source like "next episode" does. */
let picking = '';
export async function playEpisode(v: Video): Promise<void> {
  const meta = playback.meta as MetaDetail | null;
  if (!meta || picking) return;
  if (playback.next?.video.id === v.id) return playNext();
  picking = v.id;
  try {
    const s = await pickStream(meta, v.id, playback.stream);
    if (!s) {
      toast(`Couldn't find a source for ${epCode(v) || 'that episode'}. Pick one from its page.`, 'error', 7000);
      return;
    }
    await playStream(s, { meta, videoId: v.id, label: epLabel(v) });
  } catch (e) {
    toast((e as Error)?.message ?? String(e), 'error', 6000);
  } finally {
    picking = '';
  }
}

/** Skips to the next episode now, finding its source if that hasn't happened yet. */
export function skipToNext() {
  if (!playback.next) prefetchNext();
  return playNext();
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
