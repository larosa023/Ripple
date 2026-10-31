// State and controls for the built-in player (mpv embedded in Ripple's window).
import { invoke, type Prepared } from '../player';
import { isTauri } from '../stremio/http';
import type { MetaPreview } from '../stremio/types';
import { recordPlay, resumePoint, saveProgress } from './library.svelte';
import { parseArgs, settings } from './settings.svelte';

export interface Track {
  id: number;
  type: 'video' | 'audio' | 'sub';
  title?: string;
  lang?: string;
  codec?: string;
  external?: boolean;
  default?: boolean;
  'demux-channel-count'?: number;
}

interface PlaybackState {
  active: boolean;
  title: string;
  subtitle: string;
  meta: MetaPreview | null;
  videoId: string;
  /** Kept so the player can offer "open in external player". */
  source: Prepared | null;
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
  ended: boolean;
  error: string;
  fullscreen: boolean;
}

const blank = (): PlaybackState => ({
  active: false,
  title: '',
  subtitle: '',
  meta: null,
  videoId: '',
  source: null,
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
  ended: false,
  error: '',
  fullscreen: false,
});

export const playback: PlaybackState = $state(blank());

let unlisteners: (() => void)[] = [];
let saveTimer: ReturnType<typeof setInterval> | undefined;

function onProp(name: string, data: unknown) {
  switch (name) {
    case 'time-pos':
      if (typeof data === 'number') playback.time = data;
      break;
    case 'duration':
      if (typeof data === 'number') playback.duration = data;
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
      if (Array.isArray(data)) playback.tracks = data as Track[];
      break;
    case 'sid':
      playback.sid = typeof data === 'number' ? data : false;
      break;
    case 'aid':
      playback.aid = typeof data === 'number' ? data : false;
      break;
  }
}

async function subscribe() {
  const { listen } = await import('@tauri-apps/api/event');
  unlisteners = await Promise.all([
    listen<{ name: string; data: unknown }>('player://prop', (e) => onProp(e.payload.name, e.payload.data)),
    listen('player://loaded', () => {
      playback.loaded = true;
      playback.buffering = false;
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
}

function persistProgress() {
  if (playback.videoId && playback.duration > 0) saveProgress(playback.videoId, playback.time, playback.duration);
}

/** Starts a stream inside Ripple. Throws NEED_MPV:... if mpv isn't installed. */
export async function openPlayer(p: Prepared, info: { title: string; subtitle: string; meta: MetaPreview; videoId: string }) {
  if (playback.active) await closePlayer(false);
  Object.assign(playback, blank(), {
    active: true,
    title: info.title,
    subtitle: info.subtitle,
    meta: info.meta,
    videoId: info.videoId,
    source: p,
  });
  document.documentElement.classList.add('playing');
  try {
    await subscribe();
    const start = settings.resume ? resumePoint(info.videoId) : 0;
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
      },
    });
    recordPlay(info.meta, info.videoId, info.subtitle);
    saveTimer = setInterval(persistProgress, 5000);
  } catch (e) {
    await closePlayer(false);
    throw e;
  }
}

export async function closePlayer(stopMpv = true) {
  persistProgress();
  clearInterval(saveTimer);
  unlisteners.forEach((u) => u());
  unlisteners = [];
  if (stopMpv && isTauri) await invoke('player_stop').catch(() => {});
  if (playback.fullscreen) await setFullscreen(false);
  Object.assign(playback, blank());
  document.documentElement.classList.remove('playing');
}

// ---------- controls ----------

export function mpv(...args: unknown[]) {
  return invoke('player_command', { args }).catch(() => undefined);
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

export async function setFullscreen(on: boolean) {
  playback.fullscreen = on;
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setFullscreen(on).catch(() => {});
}

export const toggleFullscreen = () => setFullscreen(!playback.fullscreen);

// ---------- labels ----------

const LANGS: Record<string, string> = {
  eng: 'English', en: 'English', spa: 'Spanish', es: 'Spanish', fre: 'French', fra: 'French', fr: 'French',
  ger: 'German', deu: 'German', de: 'German', ita: 'Italian', it: 'Italian', por: 'Portuguese', pt: 'Portuguese',
  jpn: 'Japanese', ja: 'Japanese', kor: 'Korean', ko: 'Korean', chi: 'Chinese', zho: 'Chinese', zh: 'Chinese',
  rus: 'Russian', ru: 'Russian', ara: 'Arabic', ar: 'Arabic', hin: 'Hindi', hi: 'Hindi', dut: 'Dutch', nld: 'Dutch',
  pol: 'Polish', tur: 'Turkish', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', gre: 'Greek',
  heb: 'Hebrew', tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', ukr: 'Ukrainian', cze: 'Czech', hun: 'Hungarian',
  rum: 'Romanian', ron: 'Romanian', und: 'Unknown',
};

export function trackLabel(t: Track): string {
  const lang = t.lang ? (LANGS[t.lang.toLowerCase()] ?? t.lang.toUpperCase()) : '';
  const ch = t['demux-channel-count'];
  const extra = [t.codec?.toUpperCase(), ch ? (ch === 6 ? '5.1' : ch === 8 ? '7.1' : ch === 2 ? 'Stereo' : `${ch}ch`) : '']
    .filter(Boolean)
    .join(' · ');
  const name = [lang, t.title && t.title !== lang ? t.title : ''].filter(Boolean).join(' — ') || `Track ${t.id}`;
  return extra && t.type === 'audio' ? `${name} (${extra})` : t.external ? `${name} (addon)` : name;
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
