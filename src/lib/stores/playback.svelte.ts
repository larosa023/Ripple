// State and controls for the built-in player (mpv embedded in Ripple's window).
import { invoke, stopTorrents, type Prepared } from '../player';
import { isTauri } from '../stremio/http';
import { setBackdropClear } from '../backdrop';
import { baseLang, langName, sameLang } from '../lang';
import type { MetaDetail, SourcedStream, Video } from '../stremio/types';
import { fromAniSkip, fromChapters, mergeSegments, type Chapter, type Segment } from '../skip';
import { recordPlay, resumePoint, saveProgress } from './library.svelte';
import { parseArgs, settings } from './settings.svelte';
import { rememberShow, shows } from './shows.svelte';
import { startCaption, stopCaption } from '../caption';

export interface NextUp {
  video: Video;
  label: string;
  stream: SourcedStream | null;
  status: 'finding' | 'ready' | 'none';
}

export interface Track {
  id: number;
  type: 'video' | 'audio' | 'sub';
  title?: string;
  lang?: string;
  codec?: string;
  external?: boolean;
  'external-filename'?: string;
  default?: boolean;
  forced?: boolean;
  'hearing-impaired'?: boolean;
  'demux-channel-count'?: number;
}

/** Set while watching a live TV channel (no seeking, progress or next episode). */
export interface LiveInfo {
  id: string;
  name: string;
  logo: string;
  group: string;
}

interface PlaybackState {
  active: boolean;
  live: LiveInfo | null;
  title: string;
  subtitle: string;
  meta: MetaDetail | null;
  videoId: string;
  /** Kept so the player can offer "open in external player". */
  source: Prepared | null;
  /** The stream picked, so the next episode can use the same release. */
  stream: SourcedStream | null;
  chapters: Chapter[];
  /** Intro / recap / credits markers (file chapters + AniSkip). */
  segments: Segment[];
  next: NextUp | null;
  /** Shrunk into a corner while you browse. */
  mini: boolean;
  subDelay: number;
  audioDelay: number;
  // mpv properties
  time: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
  cachePct: number;
  cacheTime: number;
  volume: number;
  muted: boolean;
  speed: number;
  tracks: Track[];
  sid: number | false;
  aid: number | false;
  loaded: boolean;
  /** mpv has drawn a video frame (or audio is clearly playing), so the picture can show through. */
  ready: boolean;
  ended: boolean;
  error: string;
  fullscreen: boolean;
}

const blank = (): PlaybackState => ({
  active: false,
  live: null,
  title: '',
  subtitle: '',
  meta: null,
  videoId: '',
  source: null,
  stream: null,
  chapters: [],
  segments: [],
  next: null,
  mini: false,
  subDelay: 0,
  audioDelay: 0,
  time: 0,
  duration: 0,
  paused: false,
  buffering: true,
  cachePct: 0,
  cacheTime: 0,
  volume: settings.volume,
  muted: false,
  speed: 1,
  tracks: [],
  sid: false,
  aid: false,
  loaded: false,
  ready: false,
  ended: false,
  error: '',
  fullscreen: false,
});

export const playback: PlaybackState = $state(blank());

let unlisteners: (() => void)[] = [];
let firstTime: number | null = null;
let saveTimer: ReturnType<typeof setInterval> | undefined;
let tracksApplied = false;
let aniskipFor = '';

function onProp(name: string, data: unknown) {
  switch (name) {
    case 'time-pos':
      if (typeof data === 'number') {
        // Audio-only streams never report a video size; treat steady playback as ready.
        if (playback.loaded && firstTime !== null && Math.abs(data - firstTime) > 0.8) playback.ready = true;
        if (firstTime === null) firstTime = data;
        playback.time = data;
      }
      break;
    case 'video-params/w':
      // A video size means mpv is rendering frames; let a few paint before revealing.
      if (typeof data === 'number' && data > 0) setTimeout(() => (playback.ready = playback.active), 120);
      break;
    case 'duration':
      if (typeof data === 'number') {
        playback.duration = data;
        updateSegments();
        void loadAniSkip();
      }
      break;
    case 'pause':
      playback.paused = !!data;
      break;
    case 'paused-for-cache':
      playback.buffering = !!data;
      break;
    case 'cache-buffering-state':
      if (typeof data === 'number') playback.cachePct = data;
      break;
    case 'demuxer-cache-time':
      if (typeof data === 'number') playback.cacheTime = data;
      break;
    case 'eof-reached':
      playback.ended = !!data;
      break;
    case 'volume':
      if (typeof data === 'number') {
        playback.volume = data;
        settings.volume = Math.round(data);
      }
      break;
    case 'mute':
      playback.muted = !!data;
      break;
    case 'speed':
      if (typeof data === 'number') playback.speed = data;
      break;
    case 'track-list':
      if (Array.isArray(data)) {
        playback.tracks = data as Track[];
        if (playback.loaded && !tracksApplied) setTimeout(applyShowTracks, 250);
      }
      break;
    case 'chapter-list':
      if (Array.isArray(data)) {
        playback.chapters = data as Chapter[];
        updateSegments();
      }
      break;
    case 'sid':
      playback.sid = typeof data === 'number' ? data : false;
      break;
    case 'aid':
      playback.aid = typeof data === 'number' ? data : false;
      break;
  }
}

/** Bumped on every open/close, so a slow start that finishes late knows it was superseded. */
let startToken = 0;

async function subscribe(token: number) {
  const { listen } = await import('@tauri-apps/api/event');
  const list = await Promise.all([
    listen<{ name: string; data: unknown }>('player://prop', (e) => onProp(e.payload.name, e.payload.data)),
    listen('player://loaded', () => {
      playback.loaded = true;
      playback.buffering = false;
      if (playback.mini) layoutMini();
      if (playback.tracks.length && !tracksApplied) setTimeout(applyShowTracks, 250);
    }),
    listen<{ reason: string; error?: string }>('player://end', (e) => {
      if (e.payload.reason === 'error') {
        playback.error = e.payload.error ? `Couldn't play this stream (${e.payload.error}).` : "Couldn't play this stream.";
        playback.buffering = false;
      }
    }),
    listen('player://exit', () => {
      if (playback.active) void closePlayer();
    }),
  ]);
  // Superseded while subscribing (another video started or the player closed): don't leak these.
  if (token !== startToken) list.forEach((u) => u());
  else unlisteners = list;
}

function persistProgress() {
  if (!playback.live && playback.videoId && playback.duration > 0) saveProgress(playback.videoId, playback.time, playback.duration);
}

/** Starts a stream inside Ripple. Throws NEED_MPV:... if mpv isn't installed. */
export async function openPlayer(
  p: Prepared,
  info: { title: string; subtitle: string; meta: MetaDetail | null; videoId: string; stream?: SourcedStream | null; live?: LiveInfo },
) {
  // Switching videos (next episode): keep the player window, fullscreen and mini mode as they are.
  const keep = playback.active ? { fullscreen: playback.fullscreen, mini: playback.mini } : null;
  if (playback.active) teardown(p.torrent);
  else if (isTauri) stopTorrents(p.torrent);
  const token = ++startToken;
  firstTime = null;
  tracksApplied = false;
  aniskipFor = '';
  lastAniSkip = [];
  Object.assign(playback, blank(), keep ?? {}, {
    active: true,
    title: info.title,
    subtitle: info.subtitle,
    meta: info.meta,
    videoId: info.videoId,
    source: p,
    stream: info.stream ?? null,
    live: info.live ?? null,
  });
  // The page goes see-through so mpv's picture shows; the player's black cover hides
  // everything until the first frame arrives.
  setBackdropClear(true);
  document.documentElement.classList.add('playing');
  try {
    await subscribe(token);
    if (token !== startToken) return;
    const start = settings.resume && !info.live ? resumePoint(info.videoId) : 0;
    await invoke('player_start', {
      req: {
        url: p.url,
        title: info.subtitle ? `${info.title} — ${info.subtitle}` : info.title,
        subtitles: p.subtitles,
        headers: p.headers,
        startSeconds: start || null,
        path: settings.player === 'mpv' && settings.playerPath ? settings.playerPath : null,
        extraArgs: settings.player === 'mpv' ? parseArgs(settings.playerArgs) : [],
        subLangs: settings.subtitleLangs,
        volume: settings.volume,
        live: !!info.live,
        screenshotDir: await picturesFolder(),
      },
    });
    if (token !== startToken || !playback.active) {
      // Closed (Back/Esc) or replaced while mpv was starting: make sure nothing keeps playing.
      if (!playback.active) await invoke('player_stop').catch(() => {});
      return;
    }
    if (!info.live) void startCaption(p, start, info.subtitle ? `${info.title} — ${info.subtitle}` : info.title);
    if (info.meta && !info.live) {
      recordPlay(info.meta, info.videoId, info.subtitle);
      clearInterval(saveTimer);
      saveTimer = setInterval(persistProgress, 5000);
    }
  } catch (e) {
    if (token !== startToken || String(e).startsWith('CANCELLED:')) return; // superseded; not an error
    await closePlayer(false);
    throw e;
  }
}

let pictures: string | null | undefined;
async function picturesFolder(): Promise<string | null> {
  if (pictures !== undefined) return pictures;
  try {
    const path = await import('@tauri-apps/api/path');
    pictures = await path.join(await path.pictureDir(), 'Ripple');
  } catch {
    pictures = null;
  }
  return pictures;
}

/** Saves progress and drops event listeners, leaving the window state alone. */
function teardown(keepTorrent?: string) {
  stopCaption();
  // Every torrent but the one about to play stops, including ones started for an external
  // player or a start that failed partway.
  if (isTauri) stopTorrents(keepTorrent);
  persistProgress();
  clearInterval(saveTimer);
  unlisteners.forEach((u) => u());
  unlisteners = [];
}

export async function closePlayer(stopMpv = true, keepTorrent?: string) {
  startToken++;
  teardown(keepTorrent);
  // Bring the app back first, then stop mpv. The other way round leaves a moment where
  // neither the page nor the video covers the (transparent) window and the desktop shows.
  const leaveFs = playback.fullscreen && playerFullscreen;
  Object.assign(playback, blank(), { fullscreen: playback.fullscreen });
  document.documentElement.classList.remove('playing', 'mini');
  setBackdropClear(false);
  if (stopMpv && isTauri) await invoke('player_stop').catch(() => {});
  // Leave fullscreen only if the player turned it on; fullscreen chosen on a page stays.
  if (leaveFs) await setFullscreen(false);
}

// ---------- skip markers ----------

function updateSegments(aniskip?: Segment[]) {
  const ch = fromChapters(playback.chapters, playback.duration);
  if (aniskip) lastAniSkip = aniskip;
  playback.segments = mergeSegments(ch, lastAniSkip);
}
let lastAniSkip: Segment[] = [];

async function loadAniSkip() {
  const id = playback.videoId;
  if (!id || aniskipFor === id || !(playback.duration > 0) || !playback.meta || playback.meta.type === 'movie') return;
  aniskipFor = id;
  lastAniSkip = [];
  const segs = await fromAniSkip(id, playback.duration);
  if (playback.videoId === id) updateSegments(segs);
}

// ---------- subtitle look ----------

/** Pushes the subtitle style from Settings to mpv. Safe to call any time. */
export function applySubStyle() {
  if (!playback.active) return;
  const s = settings;
  setProp('sub-font', s.subFont || 'sans-serif');
  setProp('sub-scale', s.subScale);
  setProp('sub-color', s.subColor);
  setProp('sub-bold', s.subBold);
  setProp('sub-pos', s.subPos);
  setProp('sub-ass-override', s.subOverride ? 'force' : 'yes');
  if (s.subStyle === 'box') {
    // background-box is mpv 0.38+, opaque-box older; sub-back-color alone works on 0.37.
    setProp('sub-border-style', 'background-box').then((r) => r === undefined && setProp('sub-border-style', 'opaque-box'));
    const a = Math.round(Math.min(1, Math.max(0, s.subBack ?? 0.7)) * 255).toString(16).padStart(2, '0').toUpperCase();
    setProp('sub-back-color', `#${a}000000`);
    setProp('sub-border-size', 0);
    setProp('sub-shadow-offset', 0);
  } else {
    setProp('sub-border-style', 'outline-and-shadow');
    setProp('sub-back-color', '#00000000');
    setProp('sub-border-color', '#000000');
    setProp('sub-border-size', s.subStyle === 'outline' ? 3 : 0.8);
    setProp('sub-shadow-offset', s.subStyle === 'shadow' ? 2.5 : 0);
    setProp('sub-shadow-color', '#C0000000');
  }
}

export function setSubDelay(seconds: number) {
  playback.subDelay = Math.round(seconds * 10) / 10;
  setProp('sub-delay', playback.subDelay);
}

/** Shifts audio when it's out of sync with the picture (positive = later). */
export function setAudioDelay(seconds: number) {
  playback.audioDelay = Math.round(Math.max(-10, Math.min(10, seconds)) * 10) / 10;
  setProp('audio-delay', playback.audioDelay);
}

export type Aspect = 'fit' | 'fill' | 'stretch';
export const ASPECT_LABEL: Record<Aspect, string> = { fit: 'Fit', fill: 'Fill (crop)', stretch: 'Stretch' };

/** Fit shows the whole picture; Fill crops to cover the screen (no black bars); Stretch distorts. */
export function applyAspect() {
  if (!playback.active) return;
  const a = settings.videoAspect;
  setProp('keepaspect', a !== 'stretch');
  setProp('panscan', a === 'fill' ? 1 : 0);
}

export function cycleAspect(): Aspect {
  const order: Aspect[] = ['fit', 'fill', 'stretch'];
  settings.videoAspect = order[(order.indexOf(settings.videoAspect) + 1) % order.length];
  applyAspect();
  return settings.videoAspect;
}

/** Saves the current frame to Pictures\Ripple. Resolves with the file name when mpv reports it. */
export async function screenshot(withSubs = false): Promise<string | null> {
  const r = (await mpv('screenshot', withSubs ? 'subtitles' : 'video')) as { filename?: string } | null | undefined;
  if (r === undefined) throw new Error("Couldn't take a screenshot.");
  return r?.filename ?? null;
}

// ---------- per-show tracks ----------

const episodic = () => !!playback.meta && playback.meta.type !== 'movie';

/** A track's language, including addon subtitles (whose language mpv can't see). */
export function trackLang(t: Track): string {
  if (t.external) {
    const info = playback.source?.subInfo?.find((s) => s.url === t['external-filename']);
    if (info?.lang) return info.lang;
  }
  return t.lang ?? '';
}

/** Picks the audio and subtitle tracks you used last time for this show. */
function applyShowTracks() {
  if (tracksApplied || !playback.active || !playback.tracks.length) return;
  tracksApplied = true;
  const pref = settings.rememberPerShow && episodic() && playback.meta ? shows[playback.meta.id] : undefined;
  if (!pref) return;
  if (pref.audioLang) {
    const a = playback.tracks.find((t) => t.type === 'audio' && sameLang(trackLang(t), pref.audioLang));
    if (a && a.id !== playback.aid) setAudio(a.id);
  }
  if (pref.subLang === 'off') {
    if (playback.sid !== false) setSub(false);
  } else if (pref.subLang) {
    const subs = playback.tracks.filter((t) => t.type === 'sub' && sameLang(trackLang(t), pref.subLang));
    const pick = subs.find((t) => (t.title ?? '') === (pref.subTitle ?? '')) ?? subs[0];
    if (pick && pick.id !== playback.sid) setSub(pick.id);
  }
}

/** Track choices made in the player menus; remembered for the show. */
export function chooseAudio(t: Track) {
  setAudio(t.id);
  if (settings.rememberPerShow && episodic() && playback.meta) rememberShow(playback.meta.id, { audioLang: trackLang(t).toLowerCase() || undefined });
}

export function chooseSub(t: Track | null) {
  setSub(t ? t.id : false);
  if (settings.rememberPerShow && episodic() && playback.meta) {
    rememberShow(playback.meta.id, t ? { subLang: trackLang(t).toLowerCase() || undefined, subTitle: t.title ?? '' } : { subLang: 'off', subTitle: '' });
  }
}

// ---------- mini player ----------

/** Pixel box of the mini player, kept 16:9 and clear of the dock. */
export function miniRect() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.round(Math.max(300, Math.min(480, vw * 0.3)));
  const h = Math.round((w * 9) / 16);
  const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-space')) || 0;
  const x = vw - w - 20;
  const y = vh - h - 20 - (dock ? dock - 8 : 0);
  return { x, y, w, h, vw, vh };
}

/** Positions the hole in the app and mpv's picture to the same corner box. */
export function layoutMini() {
  const root = document.documentElement;
  if (!playback.mini) {
    root.style.removeProperty('--mini-clip');
    for (const side of ['left', 'right', 'top', 'bottom']) setProp(`video-margin-ratio-${side}`, 0);
    return;
  }
  const { x, y, w, h, vw, vh } = miniRect();
  // The UI-scale setting zooms the page, so CSS sizes are divided by it; mpv's margins use real pixels.
  const z = parseFloat(document.body.style.zoom) || 1;
  const css = (n: number) => n / z;
  const r = 12;
  const [cx, cy, cw, ch, cvw, cvh] = [x, y, w, h, vw, vh].map(css);
  root.style.setProperty('--mini-x', `${cx}px`);
  root.style.setProperty('--mini-y', `${cy}px`);
  root.style.setProperty('--mini-w', `${cw}px`);
  root.style.setProperty('--mini-h', `${ch}px`);
  // Everything except a rounded box: the app paints around it and mpv shows through.
  const hole = `M${cx + r} ${cy}H${cx + cw - r}A${r} ${r} 0 0 1 ${cx + cw} ${cy + r}V${cy + ch - r}A${r} ${r} 0 0 1 ${cx + cw - r} ${cy + ch}H${cx + r}A${r} ${r} 0 0 1 ${cx} ${cy + ch - r}V${cy + r}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`;
  root.style.setProperty('--mini-clip', `path(evenodd, "M0 0H${cvw}V${cvh}H0Z${hole}")`);
  setProp('video-margin-ratio-left', x / vw);
  setProp('video-margin-ratio-right', (vw - x - w) / vw);
  setProp('video-margin-ratio-top', y / vh);
  setProp('video-margin-ratio-bottom', (vh - y - h) / vh);
}

export async function setMini(on: boolean) {
  if (!playback.active || playback.mini === on) return;
  if (on && playback.fullscreen) await setFullscreen(false);
  playback.mini = on;
  document.documentElement.classList.toggle('mini', on);
  layoutMini();
}

// ---------- controls ----------

// Commands go out one at a time so mpv's pipe never sees a burst of simultaneous connections.
let queue: Promise<unknown> = Promise.resolve();
export function mpv(...args: unknown[]): Promise<unknown> {
  // Never let one stuck command hold up the queue (Rust also gives up after 4s).
  const run = () =>
    Promise.race([
      invoke('player_command', { args }).then((r) => r ?? null).catch(() => undefined),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 5000)),
    ]);
  const p = queue.then(run, run);
  queue = p;
  return p;
}

export const setProp = (name: string, value: unknown) => mpv('set_property', name, value);

export function togglePause() {
  if (playback.ended) {
    mpv('seek', 0, 'absolute');
    setProp('pause', false);
    return;
  }
  playback.paused = !playback.paused; // optimistic, mpv confirms via events
  setProp('pause', playback.paused);
}

export function seekTo(seconds: number) {
  const t = Math.max(0, Math.min(seconds, playback.duration || seconds));
  playback.time = t;
  mpv('seek', t, 'absolute');
}

export const seekBy = (delta: number) => seekTo(playback.time + delta);

export function setVolume(v: number) {
  const vol = Math.max(0, Math.min(130, Math.round(v)));
  playback.volume = vol;
  setProp('volume', vol);
  if (playback.muted && vol > 0) setProp('mute', false);
}

export const toggleMute = () => setProp('mute', !playback.muted);
export const setSpeed = (s: number) => setProp('speed', s);
export const setSub = (id: number | false) => setProp('sid', id === false ? 'no' : id);
export const setAudio = (id: number) => setProp('aid', id);

export function cycleSubs() {
  const subs = playback.tracks.filter((t) => t.type === 'sub');
  if (!subs.length) return;
  const i = subs.findIndex((t) => t.id === playback.sid);
  setSub(i + 1 < subs.length ? subs[i + 1].id : false);
}

/** True when the current fullscreen was entered from the player (so closing it should exit). */
let playerFullscreen = false;

/** Window fullscreen, shared by the player and pages (one source of truth). */
export async function setFullscreen(on: boolean, fromPlayer = true) {
  if (on) playerFullscreen = fromPlayer && (playback.active || playerFullscreen);
  else playerFullscreen = false;
  playback.fullscreen = on;
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setFullscreen(on).catch(() => {});
}

export const toggleFullscreen = () => setFullscreen(!playback.fullscreen);

// ---------- labels ----------

/** A track broken into what a menu shows: the language, a short detail line and small tags. */
export interface TrackParts {
  name: string;
  detail: string;
  tags: string[];
  /** Language family, for sorting and matching preferences. */
  base: string;
  /** Came from a subtitle addon rather than the video file. */
  addon: boolean;
}

const AUDIO_CODECS: Record<string, string> = {
  eac3: 'Dolby Digital Plus', ac3: 'Dolby Digital', truehd: 'Dolby TrueHD', dts: 'DTS', 'dts-hd': 'DTS-HD', dca: 'DTS',
  aac: 'AAC', opus: 'Opus', flac: 'FLAC', mp3: 'MP3', vorbis: 'Vorbis', alac: 'ALAC', pcm_s16le: 'PCM', pcm_s24le: 'PCM',
};
const SUB_CODECS: Record<string, string> = {
  subrip: 'SRT', srt: 'SRT', webvtt: 'WebVTT', ass: 'Styled', ssa: 'Styled', mov_text: 'Text',
  hdmv_pgs_subtitle: 'Image', pgssub: 'Image', dvd_subtitle: 'Image', dvdsub: 'Image', dvb_subtitle: 'Image',
};
const TAG_WORDS: [RegExp, string][] = [
  [/\bforced\b/i, 'Forced'],
  [/\b(sdh|hearing[- ]impaired)\b/i, 'SDH'],
  [/\b(cc|closed captions?)\b/i, 'CC'],
  [/\bcommentary\b/i, 'Commentary'],
  [/\b(audio description|descriptive|\bad\b)\b/i, 'Described'],
  [/\bsigns?( ?(&|and) ?songs?)?\b/i, 'Signs'],
];

function channels(n?: number): string {
  if (!n) return '';
  return n === 1 ? 'Mono' : n === 2 ? 'Stereo' : n === 6 ? '5.1' : n === 8 ? '7.1' : `${n} ch`;
}

/** Strips what the menu already shows (language, tags, brackets) out of a track title. */
function leftover(title: string, lang: string): string {
  let t = ` ${title} `;
  for (const [re] of TAG_WORDS) t = t.replace(new RegExp(re.source, 'gi'), ' ');
  if (lang) t = t.replace(new RegExp(`\\b${lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  t = t
    .replace(/[\[\](){}]/g, ' ')
    .replace(/\s*[-–—|·:,]+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // File names, hashes and ids (the "random numbers" some addons send) say nothing useful.
  if (/^[\d\s._-]+$/.test(t) || /^[a-f0-9]{8,}$/i.test(t) || /\.(srt|vtt|ass|ssa|sub)$/i.test(t) || /^track ?\d+$/i.test(t)) return '';
  return t;
}

export function trackParts(t: Track): TrackParts {
  const info = t.external ? playback.source?.subInfo?.find((s) => s.url === t['external-filename']) : undefined;
  const code = trackLang(t);
  let name = langName(code);
  const title = (t.title ?? '').trim();
  const tags: string[] = [];
  for (const [re, tag] of TAG_WORDS) if (re.test(title) && !tags.includes(tag)) tags.push(tag);
  if (t.forced && !tags.includes('Forced')) tags.push('Forced');
  if (t['hearing-impaired'] && !tags.includes('SDH')) tags.push('SDH');

  // Regional names read better as "Portuguese" + "Brazilian" than "Brazilian Portuguese".
  const base = baseLang(code);
  let region = '';
  if (name && base && name.toLowerCase() !== base && name.toLowerCase().endsWith(base)) {
    region = name.slice(0, name.length - base.length).trim();
    name = base.charAt(0).toUpperCase() + base.slice(1);
  }
  let extra = info ? '' : leftover(title, name);
  if (region && extra) extra = leftover(extra, region);
  if (!name) {
    // No language: fall back to a readable title, else a plain numbered track.
    name = extra || (t.type === 'audio' ? `Audio ${t.id}` : `Subtitles ${t.id}`);
    extra = '';
  }

  const bits: string[] = [];
  if (region) bits.push(region);
  if (extra) bits.push(extra);
  if (t.type === 'audio') {
    const codec = (t.codec ?? '').toLowerCase();
    bits.push(AUDIO_CODECS[codec] ?? (codec ? codec.toUpperCase() : ''));
    bits.push(channels(t['demux-channel-count']));
  } else if (info) {
    bits.push(info.source || 'Subtitle addon');
  } else if (t.external) {
    bits.push('External file');
  } else {
    const c = SUB_CODECS[(t.codec ?? '').toLowerCase()];
    if (c === 'Image' || c === 'Styled') bits.push(c);
  }
  return {
    name,
    detail: [...new Set(bits.filter(Boolean))].join(' · '),
    tags,
    base: base || name.toLowerCase(),
    addon: !!info || !!t.external,
  };
}

/** One-line label, for toasts and anywhere without room for the full menu row. */
export function trackLabel(t: Track): string {
  const p = trackParts(t);
  const more = [p.detail, ...p.tags].filter(Boolean).join(', ');
  return more ? `${p.name} (${more})` : p.name;
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
