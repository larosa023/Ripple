import { isTauri } from './stremio/http';
import { subtitleRequests } from './stremio/client';
import { sameLang } from './lang';
import { describe, playableUrl } from './stremio/streams';
import { resolveDebrid } from './resolve';
import { dismiss, toast } from './stores/toast.svelte';
import type { InstalledAddon, SourcedStream, Subtitle } from './stremio/types';
import { parseArgs, settings } from './stores/settings.svelte';

export interface DetectedPlayer {
  player: string;
  path: string;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

/** Error prefix the Rust side uses when no player at all could be found. */
export const NO_PLAYER = 'NO_PLAYER:';

export function isNoPlayerError(e: unknown): boolean {
  return String((e as Error)?.message ?? e).startsWith(NO_PLAYER);
}

export function errorText(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(NO_PLAYER, '').replace('NEED_MPV:', '');
}

/** Installs mpv via winget; resolves with its path. Takes up to a minute or two. */
export async function installMpv(): Promise<string> {
  if (!isTauri) throw new Error('Install mpv from mpv.io.');
  const path = await invoke<string>('install_mpv');
  settings.player = 'mpv';
  settings.playerPath = '';
  return path;
}

export async function detectPlayers(): Promise<DetectedPlayer[]> {
  if (!isTauri) return [];
  return invoke<DetectedPlayer[]>('detect_players');
}

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export interface PlayContext {
  title: string;
  type: string;
  videoId: string;
  addons: InstalledAddon[];
}

/** Where an extra subtitle file came from, so the player can name it properly. */
export interface SubInfo {
  url: string;
  lang: string;
  /** Addon (or stream) name. */
  source: string;
}

export interface Prepared {
  url: string;
  subtitles: string[];
  /** Details for each entry in `subtitles`. */
  subInfo?: SubInfo[];
  /** Subtitles from slow addons, added to the player once they arrive. */
  lateSubs?: Promise<SubInfo[]>;
  headers: [string, string][];
  /** Info hash when the built-in torrent engine is streaming this. */
  torrent?: string;
}

interface TorrentStream {
  url: string;
  fileName: string;
  size: number;
  infoHash: string;
}

export interface TorrentStatus {
  peers: number;
  downloadSpeed: number;
  downloaded: number;
  total: number;
}

export function torrentStatus(infoHash: string): Promise<TorrentStatus> {
  return invoke<TorrentStatus>('torrent_status', { infoHash });
}

/** Stops built-in torrents and frees their disk space. */
export function stopTorrents(keep?: string, only?: string): void {
  if (isTauri) void invoke('torrent_stop_all', { keep: keep ?? null, only: only ?? null }).catch(() => {});
}

/** Whether a P2P stream will use Ripple's own engine (rather than a Stremio streaming server). */
export function usesBuiltinTorrent(s: SourcedStream): boolean {
  return !!s.infoHash && !s.url && isTauri && settings.torrentEngine === 'builtin';
}

/**
 * Resolves a stream to something a player can open, plus subtitles
 * (stream-provided first, then subtitle addons in the preferred languages).
 * Returns null for "watch on website" streams, which are opened in the browser.
 */
let prepareToken = 0;

export async function prepare(stream: SourcedStream, ctx: PlayContext): Promise<Prepared | null> {
  const token = ++prepareToken;
  if (!stream.url && !stream.infoHash && !stream.ytId && stream.externalUrl) {
    await openExternal(stream.externalUrl);
    return null;
  }
  let url = playableUrl(stream, settings.streamingServer);
  if (!url) throw new Error('This stream has no playable link.');
  let torrent: string | undefined;
  if (usesBuiltinTorrent(stream)) {
    const t = toast('Finding people sharing this torrent…', 'info', 60000);
    try {
      const r = await invoke<TorrentStream>('torrent_stream', {
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx ?? null,
        trackers: stream.sources ?? [],
        fileHint: stream.behaviorHints?.filename ?? null,
      });
      url = r.url;
      torrent = r.infoHash;
    } catch (e) {
      if (String((e as Error)?.message ?? e).startsWith('CANCELLED')) return null; // stopped while starting
      throw e;
    } finally {
      dismiss(t);
    }
    // Something else was picked while peers were being found: drop this one quietly.
    if (token !== prepareToken) {
      stopTorrents(undefined, torrent);
      return null;
    }
  }
  const headers = Object.entries(stream.behaviorHints?.proxyHeaders?.request ?? {}) as [string, string][];

  // Debrid links: resolve the addon's redirect ourselves so the player gets the file directly,
  // and wait out the "being downloaded to debrid" placeholder instead of playing it.
  if (stream.url && (describe(stream).service || /\/resolve\//i.test(stream.url))) {
    let waitToast: number | null = null;
    try {
      url = await resolveDebrid(url, headers, () => {
        waitToast ??= toast('Your debrid service is getting this file ready…', 'info', 20000);
      });
    } finally {
      if (waitToast !== null) dismiss(waitToast);
    }
  }

  const found = await findSubtitles(stream, ctx);
  const subInfo = found.now;
  const subtitles = subInfo.map((s) => s.url);
  return { url, subtitles, subInfo, headers, torrent, lateSubs: found.later };
}

/** Up to this many per language from each subtitle addon (in the addon's own ranking). */
const PER_ADDON = 3;
/** How long playback waits for subtitle addons; slower ones are added once they answer. */
const WAIT_MS = 3500;

export interface FoundSubtitles {
  /** Ready before playback starts. */
  now: SubInfo[];
  /** From addons that answered too slowly; added to the player as they arrive. */
  later: Promise<SubInfo[]>;
}

/**
 * The stream's own subtitles plus, from each subtitle addon, a few per language you listed in
 * Settings. Every addon gets its own share, so one addon can't crowd out another.
 */
export async function findSubtitles(
  stream: Pick<SourcedStream, 'subtitles' | 'addonName' | 'behaviorHints'> | null,
  ctx: { type: string; videoId: string; addons: InstalledAddon[] },
): Promise<FoundSubtitles> {
  const langs = settings.subtitleLangs
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  const own: SubInfo[] = (stream?.subtitles ?? [])
    .filter((s) => s?.url)
    .map((s) => ({ url: s.url, lang: s.lang ?? '', source: stream?.addonName ?? '' }));
  if (!langs.length) return { now: own, later: Promise.resolve([]) };

  const hints = stream?.behaviorHints;
  const requests = subtitleRequests(ctx.addons, ctx.type, ctx.videoId, {
    filename: hints?.filename,
    videoSize: hints?.videoSize,
    videoHash: hints?.videoHash,
  });
  const answers = new Map<number, (Subtitle & { addon: string })[]>();
  const settled = requests.map((r, i) =>
    r.list.then(
      (list) => void answers.set(i, list),
      () => void answers.set(i, []),
    ),
  );
  const taken = new Set(own.map((s) => s.url));
  /** Your languages in order; within each, every answered addon's best few. */
  const pick = (idx: number[]): SubInfo[] => {
    const out: SubInfo[] = [];
    for (const l of langs) {
      for (const i of idx) {
        (answers.get(i) ?? [])
          .filter((s) => sameLang(s.lang, l) && !taken.has(s.url))
          .slice(0, PER_ADDON)
          .forEach((s) => {
            taken.add(s.url);
            out.push({ url: s.url, lang: s.lang, source: s.addon });
          });
      }
    }
    return out;
  };

  await Promise.race([Promise.all(settled), new Promise((r) => setTimeout(r, WAIT_MS))]);
  const ready = requests.map((_, i) => i).filter((i) => answers.has(i));
  const now = [...own, ...pick(ready)];
  const pending = requests.map((_, i) => i).filter((i) => !answers.has(i));
  const later = pending.length ? Promise.all(pending.map((i) => settled[i])).then(() => pick(pending)) : Promise.resolve([]);
  return { now, later };
}

/** Plays a prepared stream in the configured external player. */
export async function playExternal(p: Prepared, title: string): Promise<void> {
  if (!isTauri) {
    // Browser dev mode: there is no process launcher, so hand the URL over.
    window.open(p.url, '_blank', 'noopener');
    return;
  }
  // Torrents from earlier plays stop; this one keeps streaming to the external player.
  stopTorrents(p.torrent);
  await invoke('play_external', {
    req: {
      player: settings.player,
      path: settings.playerPath || null,
      url: p.url,
      title,
      subtitles: p.subtitles,
      headers: p.headers,
      startSeconds: null,
      extraArgs: parseArgs(settings.playerArgs),
    },
  });
}

/** Error prefix used when the built-in player needs mpv installed. */
export const NEED_MPV = 'NEED_MPV:';
export function isNeedMpvError(e: unknown): boolean {
  return String((e as Error)?.message ?? e).startsWith(NEED_MPV);
}
