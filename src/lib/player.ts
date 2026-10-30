import { isTauri } from './stremio/http';
import { getSubtitles } from './stremio/client';
import { playableUrl } from './stremio/streams';
import type { InstalledAddon, SourcedStream } from './stremio/types';
import { parseArgs, settings } from './stores/settings.svelte';

export interface DetectedPlayer {
  player: string;
  path: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
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

/**
 * Plays a stream in the configured external player.
 * `externalUrl` streams (e.g. "watch on site") open in the browser instead.
 */
export async function play(
  stream: SourcedStream,
  ctx: { title: string; type: string; videoId: string; addons: InstalledAddon[] },
): Promise<void> {
  if (!stream.url && !stream.infoHash && !stream.ytId && stream.externalUrl) {
    await openExternal(stream.externalUrl);
    return;
  }
  const url = playableUrl(stream, settings.streamingServer);
  if (!url) throw new Error('This stream has no playable link.');

  // Subtitles: stream-provided first, then subtitle addons in preferred languages.
  const langs = settings.subtitleLangs
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  let subs = (stream.subtitles ?? []).map((s) => s.url);
  if (langs.length) {
    try {
      const extra = await getSubtitles(ctx.addons, ctx.type, ctx.videoId);
      subs = subs.concat(
        extra
          .filter((s) => langs.includes(s.lang.toLowerCase()))
          .slice(0, 6)
          .map((s) => s.url),
      );
    } catch {
      /* subtitles are best-effort */
    }
  }

  const headers = Object.entries(stream.behaviorHints?.proxyHeaders?.request ?? {});

  if (!isTauri) {
    // Browser dev mode: there is no process launcher, so hand the URL over.
    window.open(url, '_blank', 'noopener');
    return;
  }

  await invoke('play_external', {
    req: {
      player: settings.player,
      path: settings.playerPath || null,
      url,
      title: ctx.title,
      subtitles: subs,
      headers,
      startSeconds: null,
      extraArgs: parseArgs(settings.playerArgs),
    },
  });
}
