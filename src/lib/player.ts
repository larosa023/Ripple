import { isTauri } from './stremio/http';
import { getSubtitles } from './stremio/client';
import { describe, playableUrl } from './stremio/streams';
import { resolveDebrid } from './resolve';
import { dismiss, toast } from './stores/toast.svelte';
import type { InstalledAddon, SourcedStream } from './stremio/types';
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

export interface Prepared {
  url: string;
  subtitles: string[];
  headers: [string, string][];
}

/**
 * Resolves a stream to something a player can open, plus subtitles
 * (stream-provided first, then subtitle addons in the preferred languages).
 * Returns null for "watch on website" streams, which are opened in the browser.
 */
export async function prepare(stream: SourcedStream, ctx: PlayContext): Promise<Prepared | null> {
  if (!stream.url && !stream.infoHash && !stream.ytId && stream.externalUrl) {
    await openExternal(stream.externalUrl);
    return null;
  }
  let url = playableUrl(stream, settings.streamingServer);
  if (!url) throw new Error('This stream has no playable link.');
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

  const langs = settings.subtitleLangs
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  let subtitles = (stream.subtitles ?? []).map((s) => s.url);
  if (langs.length) {
    try {
      const extra = await getSubtitles(ctx.addons, ctx.type, ctx.videoId);
      subtitles = subtitles.concat(
        extra
          .filter((s) => s?.url && langs.includes((s.lang ?? '').toLowerCase()))
          .slice(0, 6)
          .map((s) => s.url),
      );
    } catch {
      /* subtitles are best-effort */
    }
  }
  return { url, subtitles, headers };
}

/** Plays a prepared stream in the configured external player. */
export async function playExternal(p: Prepared, title: string): Promise<void> {
  if (!isTauri) {
    // Browser dev mode: there is no process launcher, so hand the URL over.
    window.open(p.url, '_blank', 'noopener');
    return;
  }
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
